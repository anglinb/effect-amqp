import { describe, it, expect } from "vitest";
import { Effect, Layer, Stream, Duration, Ref, Fiber } from "effect";
import * as AMQPConsumer from "../src/AMQPConsumer";
import * as AMQPProducer from "../src/AMQPProducer";
import { AMQPMessage } from "@cloudamqp/amqp-client";

const testQueueName = `test-ack-queue-${Date.now()}`;

const consumerLayer = AMQPConsumer.layer({
  url: "amqp://localhost:5672",
  queue: testQueueName,
  queueOptions: { durable: true }
});

const producerLayer = AMQPProducer.layer({
  url: "amqp://localhost:5672",
  queue: testQueueName,
  queueOptions: { durable: true }
});

const combinedLayer = Layer.mergeAll(consumerLayer, producerLayer);

const runEffect = <A, E>(effect: Effect.Effect<A, E, AMQPConsumer.AMQPConsumer | AMQPProducer.AMQPProducer>) =>
  Effect.runPromise(effect.pipe(Effect.provide(combinedLayer)) as Effect.Effect<A, E, never>);

describe("AMQP Acknowledgement Behavior", () => {
  it("should requeue message when consumer dies without ack", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const testMessage = "Message that should be requeued";
      const messageId = `test-${Date.now()}`;
      
      // Publish a message with unique properties
      yield* producer.publish({
        message: testMessage,
        properties: { 
          messageId,
          deliveryMode: 2 // persistent
        }
      });
      
      // Track what we receive
      const receivedMessages = yield* Ref.make<string[]>([]);
      const receivedMessageIds = yield* Ref.make<string[]>([]);
      
      // First consumer: receives message but dies before ack
      const killedConsumerFiber = yield* Effect.fork(
        consumer.stream({
          queue: testQueueName,
          queueOptions: { durable: true },
          consumeOptions: { noAck: false }
        }).pipe(
          Stream.tap((message: AMQPMessage) =>
            Effect.gen(function* () {
              const body = message.bodyToString();
              const msgId = message.properties.messageId;
              
              yield* Ref.update(receivedMessages, msgs => [...msgs, body || ""]);
              yield* Ref.update(receivedMessageIds, ids => [...ids, msgId || ""]);
              
              // Simulate processing time before death
              yield* Effect.sleep(Duration.millis(100));
              
              // DIE without acknowledging (fiber will be interrupted)
              // message.ack() is never called
            })
          ),
          Stream.take(1),
          Stream.runDrain
        )
      );
      
      // Let the consumer start and receive the message
      yield* Effect.sleep(Duration.seconds(1));
      
      // Kill the consumer fiber (simulating unexpected death)
      yield* Fiber.interrupt(killedConsumerFiber);
      
      // Wait a bit for the message to be requeued
      yield* Effect.sleep(Duration.seconds(2));
      
      // Second consumer: should receive the same message again
      const redeliveredMessages = yield* Ref.make<string[]>([]);
      const redeliveredMessageIds = yield* Ref.make<string[]>([]);
      const redeliveredFlags = yield* Ref.make<boolean[]>([]);
      
      yield* consumer.stream({
        queue: testQueueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            const msgId = message.properties.messageId;
            const isRedelivered = message.redelivered;
            
            yield* Ref.update(redeliveredMessages, msgs => [...msgs, body || ""]);
            yield* Ref.update(redeliveredMessageIds, ids => [...ids, msgId || ""]);
            yield* Ref.update(redeliveredFlags, flags => [...flags, isRedelivered]);
            
            // This time we properly acknowledge
            yield* Effect.promise(() => message.ack());
          })
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(10))
      );
      
      // Verify the behavior
      const firstReceived = yield* Ref.get(receivedMessages);
      const firstIds = yield* Ref.get(receivedMessageIds);
      const secondReceived = yield* Ref.get(redeliveredMessages);
      const secondIds = yield* Ref.get(redeliveredMessageIds);
      const redelivFlags = yield* Ref.get(redeliveredFlags);
      
      // Both consumers should have received the same message
      expect(firstReceived).toHaveLength(1);
      expect(secondReceived).toHaveLength(1);
      expect(firstReceived[0]).toBe(testMessage);
      expect(secondReceived[0]).toBe(testMessage);
      expect(firstIds[0]).toBe(messageId);
      expect(secondIds[0]).toBe(messageId);
      
      // The second delivery should be marked as redelivered
      expect(redelivFlags[0]).toBe(true);
    });
    
    await runEffect(effect);
  });

  it("should not requeue message when properly acknowledged", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const testMessage = "Message that should be acked";
      const messageId = `ack-test-${Date.now()}`;
      
      // Publish a message
      yield* producer.publish({
        message: testMessage,
        properties: { 
          messageId,
          deliveryMode: 2
        }
      });
      
      // Track received messages
      const receivedMessages = yield* Ref.make<string[]>([]);
      
      // First consumer: receives message and acknowledges it
      yield* consumer.stream({
        queue: testQueueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            yield* Ref.update(receivedMessages, msgs => [...msgs, body || ""]);
            
            // Properly acknowledge the message
            yield* Effect.promise(() => message.ack());
          })
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(5))
      );
      
      // Wait a moment
      yield* Effect.sleep(Duration.seconds(1));
      
      // Second consumer: should not receive anything (with timeout)
      const secondReceived = yield* Ref.make<string[]>([]);
      
      const result = yield* consumer.stream({
        queue: testQueueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Ref.update(secondReceived, msgs => [...msgs, message.bodyToString() || ""])
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(3)),
        Effect.either
      );
      
      // Verify behavior
      const firstMessages = yield* Ref.get(receivedMessages);
      const secondMessages = yield* Ref.get(secondReceived);
      
      expect(firstMessages).toHaveLength(1);
      expect(firstMessages[0]).toBe(testMessage);
      
      // Second consumer should timeout (no messages available)
      expect(result._tag).toBe("Left"); // Timeout
      expect(secondMessages).toHaveLength(0);
    });
    
    await runEffect(effect);
  });

  it("should handle nack with requeue", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const testMessage = "Message to be nacked and requeued";
      const messageId = `nack-test-${Date.now()}`;
      
      // Publish a message
      yield* producer.publish({
        message: testMessage,
        properties: { messageId }
      });
      
      // Track received messages
      const receivedMessages = yield* Ref.make<string[]>([]);
      
      // First consumer: receives message and nacks it (requeue = true)
      yield* consumer.stream({
        queue: testQueueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            yield* Ref.update(receivedMessages, msgs => [...msgs, body || ""]);
            
            // Nack with requeue
            yield* Effect.promise(() => message.nack(true)); // requeue = true
          })
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(5))
      );
      
      // Wait for requeue
      yield* Effect.sleep(Duration.seconds(1));
      
      // Second consumer: should receive the requeued message
      const requeuedMessages = yield* Ref.make<string[]>([]);
      const redeliveredFlags = yield* Ref.make<boolean[]>([]);
      
      yield* consumer.stream({
        queue: testQueueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            yield* Ref.update(requeuedMessages, msgs => [...msgs, body || ""]);
            yield* Ref.update(redeliveredFlags, flags => [...flags, message.redelivered]);
            
            // Properly ack this time
            yield* Effect.promise(() => message.ack());
          })
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(5))
      );
      
      // Verify behavior
      const firstMessages = yield* Ref.get(receivedMessages);
      const secondMessages = yield* Ref.get(requeuedMessages);
      const redelivFlags = yield* Ref.get(redeliveredFlags);
      
      expect(firstMessages).toHaveLength(1);
      expect(secondMessages).toHaveLength(1);
      expect(firstMessages[0]).toBe(testMessage);
      expect(secondMessages[0]).toBe(testMessage);
      expect(redelivFlags[0]).toBe(true); // Should be marked as redelivered
    });
    
    await runEffect(effect);
  });

  it("should handle reject without requeue", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const testMessage = "Message to be rejected";
      const messageId = `reject-test-${Date.now()}`;
      
      // Publish a message
      yield* producer.publish({
        message: testMessage,
        properties: { messageId }
      });
      
      // Track received messages
      const receivedMessages = yield* Ref.make<string[]>([]);
      
      // Consumer: receives message and rejects it (requeue = false)
      yield* consumer.stream({
        queue: testQueueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            yield* Ref.update(receivedMessages, msgs => [...msgs, body || ""]);
            
            // Reject without requeue
            yield* Effect.promise(() => message.reject(false)); // requeue = false
          })
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(5))
      );
      
      // Wait a moment
      yield* Effect.sleep(Duration.seconds(1));
      
      // Second consumer: should not receive anything (message was discarded)
      const secondReceived = yield* Ref.make<string[]>([]);
      
      const result = yield* consumer.stream({
        queue: testQueueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Ref.update(secondReceived, msgs => [...msgs, message.bodyToString() || ""])
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(3)),
        Effect.either
      );
      
      // Verify behavior
      const firstMessages = yield* Ref.get(receivedMessages);
      const secondMessages = yield* Ref.get(secondReceived);
      
      expect(firstMessages).toHaveLength(1);
      expect(firstMessages[0]).toBe(testMessage);
      
      // Second consumer should timeout (message was discarded)
      expect(result._tag).toBe("Left"); // Timeout
      expect(secondMessages).toHaveLength(0);
    });
    
    await runEffect(effect);
  });
});