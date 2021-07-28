import { Construct } from 'constructs';
import { Stack, StackProps, aws_ec2 as ec2, aws_logs as logs } from 'aws-cdk-lib';

import { InspectedCloudConsumerVpc, StandardCloudConsumerVpc } from './constructs/cloud_consumer';
import { TestInstance } from './constructs/test_instance';

interface CloudConsumerStackProps extends StackProps {
  tgw: ec2.CfnTransitGateway;
  inspectionTable: ec2.CfnTransitGatewayRouteTable;
  firewallTable: ec2.CfnTransitGatewayRouteTable;
  standardTable: ec2.CfnTransitGatewayRouteTable;
  flowLogsLogGroup: logs.ILogGroup;
  inspectionTgwAttachment: ec2.CfnTransitGatewayAttachment;
}
export class CloudConsumersStack extends Stack {
  flowLogsLogGroup: logs.ILogGroup;
  firewallLogGroup: logs.ILogGroup;
  constructor(scope: Construct, id: string, props: CloudConsumerStackProps) {
    super(scope, id, props);

    // part 3 protected Cloud Consumer (orange)
    const vpcA = new InspectedCloudConsumerVpc(this, 'vpc-a', {
      cidr: '10.1.0.0/16',
      firewallTable: props.firewallTable,
      inspectionTable: props.inspectionTable,
      inspectionVpcAttachment: props.inspectionTgwAttachment,
      tgw: props.tgw,
      standardTable: props.standardTable,
      flowlogsLogGroup: props.flowLogsLogGroup,
    });
    new TestInstance(this, 'a', { vpc: vpcA.vpc, subnetGroupName: 'workload' });

    // part 4 trusted Consumer (green)
    const vpcC = new StandardCloudConsumerVpc(this, 'vpc-c', {
      cidr: '10.3.0.0/16',
      firewallTable: props.firewallTable,
      standardTable: props.standardTable,
      tgw: props.tgw,
      flowlogsLogGroup: props.flowLogsLogGroup,
    });
    new TestInstance(this, 'c', { vpc: vpcC.vpc, subnetGroupName: 'workload' });
  }
}
