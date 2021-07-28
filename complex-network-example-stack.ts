import { App, Environment } from 'aws-cdk-lib';

import { EgressVpcStack } from './egress-vpc-stack';
import { FirewallStack } from './network-firewall-stack';
import { LoggingStack } from './log-stack';
import { CloudConsumersStack } from './inspected-cloud-consumers';

import { TgwStack } from './transit-gateway-stack';

const app = new App();
const env: Environment = { region: 'us-east-1' };

//Deploy log groups
const logStack = new LoggingStack(app, 'logStack', { env });

//Deploy TGW and TGW RouteTables
const tgwStack = new TgwStack(app, 'tgwStack', { env });

//Deploy egress/internet VPC
const egressVpc = new EgressVpcStack(app, 'egressStack', {
  env,
  firewallTable: tgwStack.firewallTable,
  flowLogsLogGroup: logStack.flowLogsLogGroup,
  standardTable: tgwStack.standardTable,
  tgw: tgwStack.tgw,
});

//Deploy Inspection VPC & Network Firewall
const firewallStack = new FirewallStack(app, 'firewallStack', {
  env,
  firewallLogsLogGroup: logStack.firewallLogGroup,
  firewallTable: tgwStack.firewallTable,
  flowLogsLogGroup: logStack.flowLogsLogGroup,
  inspectionTable: tgwStack.inspectionTable,
  standardTable: tgwStack.standardTable,
  tgw: tgwStack.tgw,
});

//Deploy Cloud Consumers + test instances.
const cloudConsumersStack = new CloudConsumersStack(app, 'cloudConsumerStack', {
  env,
  firewallTable: tgwStack.firewallTable,
  flowLogsLogGroup: logStack.flowLogsLogGroup,
  inspectionTable: tgwStack.inspectionTable,
  inspectionTgwAttachment: firewallStack.inspectionVpcTgwAttachment,
  standardTable: tgwStack.standardTable,
  tgw: tgwStack.tgw,
});
