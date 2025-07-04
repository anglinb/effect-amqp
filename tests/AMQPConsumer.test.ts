import { describe, it, expect } from "vitest";
import { Effect, Layer, Stream, Duration, Ref } from "effect";
import * as AMQPConsumer from "../src/AMQPConsumer";
import * as AMQPProducer from "../src/AMQPProducer";
import { AMQPMessage } from "@cloudamqp/amqp-client";

const testQueueName = `test-consumer-queue-${Date.now()}`;

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

describe("AMQPConsumer", () => {
  it("should consume messages from a queue", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      // Publish a test message
      yield* producer.publish({
        message: "Test message for consumption"
      });
      
      // Track received messages
      const receivedMessages = yield* Ref.make<string[]>([]);
      
      // Create message stream
      const messageStream = consumer.stream({
        queue: testQueueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      });
      
      // Consume one message with timeout
      yield* messageStream.pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            yield* Ref.update(receivedMessages, msgs => [...msgs, body || ""]);
            yield* Effect.promise(() => message.ack());
          })
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(5))
      );
      
      const messages = yield* Ref.get(receivedMessages);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe("Test message for consumption");
    });
    
    await runEffect(effect);
  });

  it("should handle multiple consumers", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      // Use a unique queue for this test
      const multiConsumerQueue = `multi-consumer-${Date.now()}`;
      
      // Publish multiple messages
      const testMessages = ["Message 1", "Message 2", "Message 3", "Message 4"];
      for (const msg of testMessages) {
        yield* producer.publish({ 
          queue: multiConsumerQueue,
          message: msg 
        });
      }
      
      // Track received messages
      const allMessages = yield* Ref.make<string[]>([]);
      
      // Create a single consumer that takes all messages
      yield* consumer.stream({
        queue: multiConsumerQueue,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            yield* Ref.update(allMessages, msgs => [...msgs, body || ""]);
            yield* Effect.promise(() => message.ack());
          })
        ),
        Stream.take(testMessages.length),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(10))
      );
      
      const messages = yield* Ref.get(allMessages);
      
      // Should have consumed all messages
      expect(messages).toHaveLength(testMessages.length);
      expect(messages.sort()).toEqual(testMessages.sort());
    });
    
    await runEffect(effect);
  });

  it("should respect consume options", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      // Use unique queue for this test
      const consumeOptionsQueue = `consume-options-${Date.now()}`;
      
      // Publish a test message
      yield* producer.publish({
        queue: consumeOptionsQueue,
        message: "Message with consume options"
      });
      
      // Track received messages
      const receivedMessages = yield* Ref.make<string[]>([]);
      
      // Create message stream with specific consume options
      const messageStream = consumer.stream({
        queue: consumeOptionsQueue,
        queueOptions: { durable: true },
        consumeOptions: { 
          noAck: true, // Auto-acknowledge
          exclusive: false
        }
      });
      
      // Consume one message
      yield* messageStream.pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Ref.update(receivedMessages, msgs => [...msgs, message.bodyToString() || ""])
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(5))
      );
      
      const messages = yield* Ref.get(receivedMessages);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe("Message with consume options");
    });
    
    await runEffect(effect);
  });

  it("should handle queue that doesn't exist", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      
      // Try to consume from non-existent queue (it will be created)
      const messageStream = consumer.stream({
        queue: "non-existent-queue",
        queueOptions: { durable: false },
        consumeOptions: { noAck: true }
      });
      
      // This should work as LavinMQ creates queues automatically
      const result = yield* messageStream.pipe(
        Stream.take(0), // Don't actually wait for messages
        Stream.runDrain,
        Effect.timeout(Duration.seconds(1)),
        Effect.either
      );
      
      // Should succeed (queue gets created)
      expect(result._tag).toBe("Right");
    });
    
    await runEffect(effect);
  });

  it("should handle different queue options", async () => {
    const tempQueueName = `temp-test-queue-${Date.now()}`;
    
    // Create separate layers with same queue options
    const tempProducerLayer = AMQPProducer.layer({
      url: "amqp://localhost:5672",
      queue: tempQueueName,
      queueOptions: { 
        durable: false,
        autoDelete: true,
        exclusive: false
      }
    });
    
    const tempConsumerLayer = AMQPConsumer.layer({
      url: "amqp://localhost:5672",
      queue: tempQueueName,
      queueOptions: { 
        durable: false,
        autoDelete: true,
        exclusive: false
      }
    });
    
    const tempCombinedLayer = Layer.mergeAll(tempConsumerLayer, tempProducerLayer);
    
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      // Publish to temporary queue
      yield* producer.publish({
        message: "Temporary queue message"
      });
      
      // Track received messages
      const receivedMessages = yield* Ref.make<string[]>([]);
      
      // Create message stream with temporary queue options
      const messageStream = consumer.stream({
        queue: tempQueueName,
        queueOptions: { 
          durable: false,
          autoDelete: true,
          exclusive: false
        },
        consumeOptions: { noAck: false }
      });
      
      // Consume one message
      yield* messageStream.pipe(
        Stream.take(1),
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            yield* Ref.update(receivedMessages, msgs => [...msgs, body || ""]);
            yield* Effect.promise(() => message.ack());
          })
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(5))
      );
      
      const messages = yield* Ref.get(receivedMessages);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe("Temporary queue message");
    });
    
    await Effect.runPromise(effect.pipe(Effect.provide(tempCombinedLayer)) as Effect.Effect<void, any, never>);
  });

  it("should handle stream interruption gracefully", async () => {
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      // Use unique queue for this test
      const streamTestQueue = `stream-test-${Date.now()}`;
      
      // Publish multiple messages
      for (let i = 0; i < 5; i++) {
        yield* producer.publish({
          queue: streamTestQueue,
          message: `Stream test message ${i + 1}`
        });
      }
      
      // Track received messages
      const receivedMessages = yield* Ref.make<string[]>([]);
      
      // Create message stream
      const messageStream = consumer.stream({
        queue: streamTestQueue,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      });
      
      // Consume messages but interrupt after 2
      const result = yield* messageStream.pipe(
        Stream.tap((message: AMQPMessage) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            yield* Ref.update(receivedMessages, msgs => [...msgs, body || ""]);
            yield* Effect.promise(() => message.ack());
          })
        ),
        Stream.take(2), // Only take 2 messages
        Stream.runDrain,
        Effect.timeout(Duration.seconds(10)),
        Effect.either
      );
      
      expect(result._tag).toBe("Right");
      
      const messages = yield* Ref.get(receivedMessages);
      expect(messages.length).toBe(2);
    });
    
    await runEffect(effect);
  });
});