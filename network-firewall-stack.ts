import { Construct } from 'constructs';
import {
  CfnOutput,
  Fn,
  CustomResource,
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_lambda as lambda,
  aws_networkfirewall as nfw,
  custom_resources as cr,
  aws_logs as logs,
} from 'aws-cdk-lib';

import { TgwAttachedVpc } from './constructs/cloud_consumer';

interface FirewallStackProps extends StackProps {
  tgw: ec2.CfnTransitGateway;
  inspectionTable: ec2.CfnTransitGatewayRouteTable;
  firewallTable: ec2.CfnTransitGatewayRouteTable;
  standardTable: ec2.CfnTransitGatewayRouteTable;
  flowLogsLogGroup: logs.ILogGroup;
  firewallLogsLogGroup: logs.ILogGroup;
}

export class FirewallStack extends Stack {
  inspectionVpcTgwAttachment: ec2.CfnTransitGatewayAttachment;
  constructor(scope: Construct, id: string, props: FirewallStackProps) {
    super(scope, id, props);

    //part 1b inspection vpc and firewall
    const inspectionVpc = new TgwAttachedVpc(this, 'vpc-i', {
      cidr: '100.64.0.0/16',
      tgw: props.tgw,
      flowlogsLogGroup: props.flowLogsLogGroup,
    });

    this.inspectionVpcTgwAttachment = inspectionVpc.tgwAttachment;
    // Send all traffic to from Inspection Route Table to Inspection VPC
    new ec2.CfnTransitGatewayRoute(this, 'SpokeInspectionRoute', {
      transitGatewayRouteTableId: props.inspectionTable.ref,
      destinationCidrBlock: '0.0.0.0/0',
      transitGatewayAttachmentId: inspectionVpc.tgwAttachment.ref,
    });

    // Associate Inspection VPC with Firewall Route Table for return traffic.
    new ec2.CfnTransitGatewayRouteTableAssociation(this, 'AssociateFirewallRouteTable', {
      transitGatewayAttachmentId: inspectionVpc.tgwAttachment.ref,
      transitGatewayRouteTableId: props.firewallTable.ref,
    });

    // Add routes from Network Firewall Subnet to Transit Gateway
    inspectionVpc.vpc.selectSubnets({ subnetGroupName: 'workload' }).subnets.forEach((subnet: ec2.ISubnet, index: number) => {
      new ec2.CfnRoute(this, 'fw-tgw-route-' + index, {
        routeTableId: subnet.routeTable.routeTableId,
        transitGatewayId: props.tgw.ref,
        destinationCidrBlock: '0.0.0.0/0',
      }).addDependsOn(inspectionVpc.tgwAttachment);
    });

    // Block amazon.com as example
    const blockDomainNames = new nfw.CfnRuleGroup(this, 'domBlockList', {
      capacity: 100,
      ruleGroupName: 'domainBlockList',
      type: 'STATEFUL',
      ruleGroup: {
        ruleVariables: {
          ipSets: { LAN: { definition: ['10.0.0.0/8'] } },
        },
        rulesSource: {
          rulesSourceList: {
            targetTypes: ['HTTP_HOST', 'TLS_SNI'],
            targets: ['.amazon.com', '.facebook.com'],
            generatedRulesType: 'DENYLIST',
          },
        },
      },
    });

    // Add a default policy
    const fwPolicy = new nfw.CfnFirewallPolicy(this, 'policy', {
      firewallPolicyName: 'defaultPolicy',
      firewallPolicy: {
        statelessDefaultActions: ['aws:forward_to_sfe'],
        statelessFragmentDefaultActions: ['aws:forward_to_sfe'],
        statefulRuleGroupReferences: [{ resourceArn: blockDomainNames.ref }],
      },
    });

    // Lookup subnets for Firewall Deployment
    const fwSubnets = inspectionVpc.vpc.selectSubnets({ subnetGroupName: 'workload' }).subnetIds.map((x) => {
      return {
        subnetId: x,
      };
    });

    // Deploy Firewall
    const fw = new nfw.CfnFirewall(this, 'fw', {
      firewallName: 'inspection',
      vpcId: inspectionVpc.vpc.vpcId,
      subnetMappings: fwSubnets,
      firewallPolicyArn: fwPolicy.attrFirewallPolicyArn,
    });

    // FireWall logging behavior
    new nfw.CfnLoggingConfiguration(this, 'firewallLogging', {
      firewallArn: fw.ref,
      loggingConfiguration: {
        logDestinationConfigs: [
          {
            logDestination: {
              logGroup: props.firewallLogsLogGroup.logGroupName,
            },
            logDestinationType: 'CloudWatchLogs',
            logType: 'FLOW',
          },
          {
            logDestination: {
              logGroup: props.firewallLogsLogGroup.logGroupName,
            },
            logDestinationType: 'CloudWatchLogs',
            logType: 'ALERT',
          },
        ],
      },
    });
    // Custom resource due to
    // https://github.com/aws-cloudformation/aws-cloudformation-resource-providers-networkfirewall/issues/15
    const mySortedEndpointsProvider = new cr.Provider(this, 'crProvider', {
      onEventHandler: new lambda.Function(this, 'crLambda', {
        code: lambda.Code.fromAsset('lambda'),
        handler: 'index.sorted_endpoints_handler',
        runtime: lambda.Runtime.PYTHON_3_8,
      }),
    });

    const sortedEndpoints = new CustomResource(this, 'crEndPoints', {
      serviceToken: mySortedEndpointsProvider.serviceToken,
      properties: {
        EndpointIds: fw.attrEndpointIds,
      },
    });

    // Custom resource to set Appliance Mode on Inspection VPC attachment
    const myApplianceModeProvider = new cr.Provider(this, 'crApplianceModeProvider', {
      onEventHandler: new lambda.Function(this, 'applianceCrLambda', {
        code: lambda.Code.fromAsset('lambda'),
        handler: 'index.appliance_mode_handler',
        runtime: lambda.Runtime.PYTHON_3_8,
      }),
    });

    const applianceMode = new CustomResource(this, 'crApplianceMode', {
      serviceToken: myApplianceModeProvider.serviceToken,
      properties: {
        TgwInspectionVpcAttachmentId: this.inspectionVpcTgwAttachment.ref,
        ApplianceModeSupport: 'enable',
        DnsSupport: 'enable',
      },
    });

    //Add routes to firewall endpoint
    inspectionVpc.vpc.selectSubnets({ subnetGroupName: 'tgw' }).subnets.forEach((subnet: ec2.ISubnet, index: number) => {
      new ec2.CfnRoute(this, 'tgw-fw-route-' + index, {
        routeTableId: subnet.routeTable.routeTableId,
        vpcEndpointId: Fn.select(index, Fn.split(',', sortedEndpoints.getAttString('EndpointIds'))),
        destinationCidrBlock: '0.0.0.0/0',
      }).addDependsOn(inspectionVpc.tgwAttachment);
    });
  }
}
