import { Construct } from 'constructs';
import { aws_ec2 as ec2, aws_iam as iam } from 'aws-cdk-lib';

interface TestInstanceProps {
  vpc: ec2.IVpc;
  subnetGroupName: string;
}

export class TestInstance extends Construct {
  constructor(scope: Construct, id: string, props: TestInstanceProps) {
    super(scope, id);

    const instance = new ec2.Instance(this, 'test-instance', {
      vpc: props.vpc,
      instanceType: new ec2.InstanceType('t3.small'),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      role: iam.Role.fromRoleArn(this, 'role', 'arn:aws:iam::922457306128:role/TeamRoleEventEngine'),
      vpcSubnets: { subnetGroupName: props.subnetGroupName },
    });

    //respond to ping
    instance.connections.allowFromAnyIpv4(ec2.Port.allIcmp());
  }
}
