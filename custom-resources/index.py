import boto3
import json
import logging


def sorted_endpoints_handler(event, context):
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.info('Received event: {}'.format(json.dumps(event)))
    eids = event['ResourceProperties']['EndpointIds']
    eids.sort()
    EndpointIds = [eid.split(':')[1] for eid in eids]

    response = {}
    response['Data'] = {'EndpointIds': ','.join(EndpointIds)}

    logger.info('Response: {}'.format(json.dumps(event)))
    return response


def appliance_mode_handler(event, context):
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.info('Received event: {}'.format(json.dumps(event)))
    response = {}
    if event["RequestType"] == "Create":
        try:
            logger.info('Parsing request')
            TgwInspectionVpcAttachmentId = event["ResourceProperties"]["TgwInspectionVpcAttachmentId"]
            ApplianceMode = event["ResourceProperties"]["ApplianceModeSupport"]
            DnsSupport = event["ResourceProperties"]["DnsSupport"]
        except Exception as e:
            logger.info('Key retrieval failure: {}'.format(e))
        try:
            ec2 = boto3.client('ec2')
        except Exception as e:
            logger.info('boto3.client failure: {}'.format(e))
        try:
            ec2.modify_transit_gateway_vpc_attachment(
                TransitGatewayAttachmentId=TgwInspectionVpcAttachmentId,
                Options={
                    'ApplianceModeSupport': ApplianceMode,
                    'DnsSupport': DnsSupport
                }
            )
            logger.info('describe_transit_gateway_vpc_attachments on {}'.format(
                TgwInspectionVpcAttachmentId))
            TgwResponse = ec2.describe_transit_gateway_vpc_attachments(
                TransitGatewayAttachmentIds=[TgwInspectionVpcAttachmentId]
            )

            ApplianceModeStatus = TgwResponse['TransitGatewayVpcAttachments'][0]['Options']['ApplianceModeSupport']
            DnsSupportStatus = TgwResponse['TransitGatewayVpcAttachments'][0]['Options']['DnsSupport']

            response['Data'] = {
                'ApplianceModeStatus': ApplianceModeStatus,
                'DnsSupportStatus': DnsSupportStatus
            }
        except Exception as e:
            logger.info(
                'ec2.modify/describe_transit_gateway_vpc_attachment: {}'.format(e))

    logger.info('Response: {}'.format(json.dumps(event)))
    return response
