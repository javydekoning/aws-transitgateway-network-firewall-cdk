import { Construct } from 'constructs';
import { Stack, StackProps, aws_logs as logs } from 'aws-cdk-lib';

interface LoggingStackProps extends StackProps {
  retention?: logs.RetentionDays;
}
export class LoggingStack extends Stack {
  flowLogsLogGroup: logs.ILogGroup;
  firewallLogGroup: logs.ILogGroup;
  constructor(scope: Construct, id: string, props?: LoggingStackProps) {
    super(scope, id, props);

    const retention = props?.retention ?? logs.RetentionDays.ONE_WEEK;

    this.flowLogsLogGroup = new logs.LogGroup(this, 'flowLogsGroup', {
      logGroupName: '/networking/vpc-flowlogs',
      retention: retention,
    });

    this.firewallLogGroup = new logs.LogGroup(this, 'firewallLogsGroup', {
      logGroupName: '/networking/firewall-logs',
      retention: retention,
    });
  }
}
