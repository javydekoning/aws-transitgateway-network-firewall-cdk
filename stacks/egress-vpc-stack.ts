import { Construct } from 'constructs';
import { Stack, StackProps, aws_ec2 as ec2, aws_logs as logs } from 'aws-cdk-lib';

import { TgwAttachedVpc } from '../constructs/cloud_consumer';

interface EgressVpcStackProps extends StackProps {
  tgw: ec2.CfnTransitGateway;
  firewallTable: ec2.CfnTransitGatewayRouteTable;
  standardTable: ec2.CfnTransitGatewayRouteTable;
  flowLogsLogGroup: logs.ILogGroup;
}

export class EgressVpcStack extends Stack {
  constructor(scope: Construct, id: string, props: EgressVpcStackProps) {
    super(scope, id, props);

    const egressVpc = new TgwAttachedVpc(this, 'vpc-e', {
      cidr: '10.10.0.0/16',
      tgw: props.tgw,
      flowlogsLogGroup: props.flowLogsLogGroup,
      subnetConfiguration: [
        {
          name: 'tgw',
          subnetType: ec2.SubnetType.PRIVATE,
        },
        {
          name: 'pub',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    //associate egress VPC with Standard Route Table
    new ec2.CfnTransitGatewayRouteTableAssociation(this, 'StandardTableAssociation', {
      transitGatewayAttachmentId: egressVpc.tgwAttachment.ref,
      transitGatewayRouteTableId: props.standardTable.ref,
    });

    // Add route back to private IP space to egress VPC
    egressVpc.vpc.publicSubnets.forEach((subnet: ec2.ISubnet, index: number) => {
      new ec2.CfnRoute(this, 'vpc-e-tgw-route-' + index, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.0.0.0/8',
        transitGatewayId: props.tgw.ref,
      }).addDependsOn(egressVpc.tgwAttachment);
    });

    // Add 0.0.0.0/0 routes towards egress VPC to firewall and
    // standard route table.
    [props.firewallTable, props.standardTable].forEach((x, i) => {
      new ec2.CfnTransitGatewayRoute(this, 'EgressRoute' + i, {
        transitGatewayRouteTableId: x.ref,
        destinationCidrBlock: '0.0.0.0/0',
        transitGatewayAttachmentId: egressVpc.tgwAttachment.ref,
      });
    });
  }
}
