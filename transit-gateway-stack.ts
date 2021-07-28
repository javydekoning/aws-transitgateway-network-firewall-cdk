import { Construct } from 'constructs';
import { Stack, StackProps, aws_ec2 as ec2 } from 'aws-cdk-lib';

export class TgwStack extends Stack {
  tgw: ec2.CfnTransitGateway;
  inspectionTable: ec2.CfnTransitGatewayRouteTable;
  firewallTable: ec2.CfnTransitGatewayRouteTable;
  standardTable: ec2.CfnTransitGatewayRouteTable;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Part 1a (Purple, TransitGateway)
    this.tgw = new ec2.CfnTransitGateway(this, 'tgw', {
      autoAcceptSharedAttachments: 'enable',
      defaultRouteTablePropagation: 'disable',
      defaultRouteTableAssociation: 'disable',
    });

    // Create 3 tgw route tables
    const tgwTableList = ['firewallTable', 'standardTable', 'inspectionTable'];

    const tgwTables = tgwTableList.map((x) => {
      return new ec2.CfnTransitGatewayRouteTable(this, x, {
        transitGatewayId: this.tgw.ref,
        tags: [{ key: 'Name', value: x }],
      });
    });

    this.firewallTable = tgwTables[0];
    this.standardTable = tgwTables[1];
    this.inspectionTable = tgwTables[2];
  }
}
