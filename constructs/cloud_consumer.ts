import { Construct } from 'constructs';
import { Aws, aws_ec2 as ec2, aws_logs as logs } from 'aws-cdk-lib';

interface TgwAttachedVpcProps {
  cidr: string;
  tgw: ec2.CfnTransitGateway;
  /**
   * Overrides the default TgwAttachedConfiguration.
   * You **MUST** provide at least one entry named
   * tgw. We will use this to connect the TGW.
   *
   * ```ts
   * subnetConfiguration: [
   *       {
   *         cidrMask: 24,
   *         name: 'ingress',
   *         subnetType: ec2.SubnetType.PUBLIC,
   *       },
   *       {
   *         cidrMask: 24,
   *         name: 'application',
   *         subnetType: ec2.SubnetType.PRIVATE,
   *       },
   *       {
   *         cidrMask: 28,
   *         name: 'rds',
   *         subnetType: ec2.SubnetType.ISOLATED,
   *       }
   *    ]
   * ```
   *
   * @default - The VPC CIDR will be evenly divided between 1 TGW Attached and 1
   * 'workload' subnet per AZ.
   **/
  subnetConfiguration?: ec2.SubnetConfiguration[];
  flowlogsLogGroup?: logs.ILogGroup;
}

export class TgwAttachedVpc extends Construct {
  readonly vpc: ec2.IVpc;
  readonly tgwAttachment: ec2.CfnTransitGatewayAttachment;

  constructor(scope: Construct, id: string, props: TgwAttachedVpcProps) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'vpc', {
      cidr: props.cidr,
      subnetConfiguration: props.subnetConfiguration ?? [
        {
          name: 'tgw',
          subnetType: ec2.SubnetType.ISOLATED,
        },
        {
          name: 'workload',
          subnetType: ec2.SubnetType.ISOLATED,
        },
      ],
    });
    this.vpc.addFlowLog('flowlog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(props.flowlogsLogGroup ?? undefined),
    });

    // Add VPC Interface Endpoints for SSM / Session Manager.
    new ec2.InterfaceVpcEndpoint(this, 'ssm', {
      service: { name: `com.amazonaws.${Aws.REGION}.ssm`, port: 443 },
      vpc: this.vpc,
    });
    new ec2.InterfaceVpcEndpoint(this, 'ec2messages', {
      service: { name: `com.amazonaws.${Aws.REGION}.ec2messages`, port: 443 },
      vpc: this.vpc,
    });
    new ec2.InterfaceVpcEndpoint(this, 'ec2', {
      service: { name: `com.amazonaws.${Aws.REGION}.ec2`, port: 443 },
      vpc: this.vpc,
    });
    new ec2.InterfaceVpcEndpoint(this, 'ssmmessages', {
      service: { name: `com.amazonaws.${Aws.REGION}.ssmmessages`, port: 443 },
      vpc: this.vpc,
    });

    this.tgwAttachment = new ec2.CfnTransitGatewayAttachment(this, 'attachment', {
      subnetIds: this.vpc.selectSubnets({ subnetGroupName: 'tgw' }).subnetIds,
      vpcId: this.vpc.vpcId,
      transitGatewayId: props.tgw.ref,
      tags: [{ key: 'Name', value: id }],
    });
  }
}

interface CloudConsumerVpcProps extends TgwAttachedVpcProps {
  firewallTable: ec2.CfnTransitGatewayRouteTable;
  standardTable: ec2.CfnTransitGatewayRouteTable;
}

// This can only be instantiated by Standar or Inspected sub-classes.
abstract class CloudConsumerVpc extends TgwAttachedVpc {
  constructor(scope: Construct, id: string, props: CloudConsumerVpcProps) {
    super(scope, id, props);

    // Create subnet route table entries to TGW
    this.vpc.isolatedSubnets.forEach((subnet: ec2.ISubnet, index: number) => {
      new ec2.CfnRoute(this, 'tgw-route-' + index, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        transitGatewayId: props.tgw.ref,
      }).addDependsOn(this.tgwAttachment);
    });

    // Propagate VPC CIDR to FireWall TGW route table
    new ec2.CfnTransitGatewayRouteTablePropagation(this, 'FirewallRouteTableRoute', {
      transitGatewayAttachmentId: this.tgwAttachment.ref,
      transitGatewayRouteTableId: props.firewallTable.ref,
    }).addDependsOn(this.tgwAttachment);
  }
}

export class StandardCloudConsumerVpc extends CloudConsumerVpc {
  constructor(scope: Construct, id: string, props: CloudConsumerVpcProps) {
    super(scope, id, props);

    // Propagate VPC CIDR to Standard TGW route table
    new ec2.CfnTransitGatewayRouteTablePropagation(this, 'StandardRouteTableRoute', {
      transitGatewayAttachmentId: this.tgwAttachment.ref,
      transitGatewayRouteTableId: props.standardTable.ref,
    }).addDependsOn(this.tgwAttachment);

    // Associate VPC TGW Attachment with Standard Route Table
    new ec2.CfnTransitGatewayRouteTableAssociation(this, 'StandardTableAssociation', {
      transitGatewayAttachmentId: this.tgwAttachment.ref,
      transitGatewayRouteTableId: props.standardTable.ref,
    });
  }
}

export interface InspectedCloudConsumerVpcProps extends CloudConsumerVpcProps {
  inspectionVpcAttachment: ec2.CfnTransitGatewayAttachment;
  inspectionTable: ec2.CfnTransitGatewayRouteTable;
}
export class InspectedCloudConsumerVpc extends CloudConsumerVpc {
  constructor(scope: Construct, id: string, props: InspectedCloudConsumerVpcProps) {
    super(scope, id, props);

    // Send return traffic to inspection VPC
    new ec2.CfnTransitGatewayRoute(this, 'StandardRouteTableRoute', {
      transitGatewayRouteTableId: props.standardTable.ref,
      destinationCidrBlock: props.cidr,
      transitGatewayAttachmentId: props.inspectionVpcAttachment.ref,
    });

    // Associate VPC TGW Attachment with Inspection Route Table
    new ec2.CfnTransitGatewayRouteTableAssociation(this, id + 'InspectionTableAssociation', {
      transitGatewayAttachmentId: this.tgwAttachment.ref,
      transitGatewayRouteTableId: props.inspectionTable.ref,
    });
  }
}
