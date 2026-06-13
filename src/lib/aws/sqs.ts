import {
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";
import { sqsClient } from "./client.js";
import { getEnvConfig } from "../../config/env.js";

export interface SendOptions {
  delaySeconds?: number;
  messageGroupId?: string;
  deduplicationId?: string;
}

export interface ReceiveOptions {
  maxMessages?: number;
  visibilityTimeout?: number;
  waitTimeSeconds?: number;
}

export interface ReceivedMessage {
  messageId: string | undefined;
  receiptHandle: string | undefined;
  // Raw, unparsed SQS body. The consumer parses it inside its own per-message
  // guard so one malformed body cannot abort the whole batch receive.
  body: string;
  attributes: Record<string, string>;
}

/**
 * Send a message to an SQS queue.
 */
export async function sendMessage(
  queueUrl: string,
  body: unknown,
  options: SendOptions = {},
): Promise<string | undefined> {
  const { delaySeconds, messageGroupId, deduplicationId } = options;

  const response = await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(body),
      ...(delaySeconds !== undefined && { DelaySeconds: delaySeconds }),
      ...(messageGroupId && { MessageGroupId: messageGroupId }),
      ...(deduplicationId && { MessageDeduplicationId: deduplicationId }),
    }),
  );

  return response.MessageId;
}

/**
 * Receive messages from an SQS queue.
 * Uses long polling by default — avoids busy-waiting and reduces cost.
 */
export async function receiveMessages(
  queueUrl: string,
  options: ReceiveOptions = {},
): Promise<ReceivedMessage[]> {
  const {
    visibilityTimeout: defaultVisibility,
    waitTime,
    maxMessages: defaultMax,
  } = getEnvConfig().aws.sqs;
  const {
    maxMessages = defaultMax,
    visibilityTimeout = defaultVisibility,
    waitTimeSeconds = waitTime,
  } = options;

  const response = await sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      VisibilityTimeout: visibilityTimeout,
      WaitTimeSeconds: waitTimeSeconds,
      // always fetch these — needed for dedup and tracing
      AttributeNames: ["All"],
      MessageAttributeNames: ["All"],
    }),
  );

  return (response.Messages ?? []).map((msg) => ({
    messageId: msg.MessageId,
    receiptHandle: msg.ReceiptHandle,
    // Raw body — parsed per-message by the consumer (see sqsPoller) so a single
    // malformed body fails only that message, not the entire batch receive.
    body: msg.Body ?? "null",
    attributes: (msg.Attributes ?? {}) as Record<string, string>,
  }));
}

/**
 * Delete a message from the queue after successful processing.
 * Must be called with the receiptHandle from receiveMessages — not the messageId.
 * Failing to delete causes the message to reappear after visibilityTimeout expires.
 */
export async function deleteMessage(
  queueUrl: string,
  receiptHandle: string,
): Promise<void> {
  await sqsClient.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    }),
  );
}

/**
 * Extend visibility timeout for a message being processed.
 * Call this if processing takes longer than the initial visibilityTimeout
 * to prevent the message from reappearing in the queue mid-processing.
 */
export async function extendVisibility(
  queueUrl: string,
  receiptHandle: string,
  visibilityTimeout: number,
): Promise<void> {
  await sqsClient.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeout,
    }),
  );
}
