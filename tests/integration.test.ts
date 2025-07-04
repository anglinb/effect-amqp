import { describe, it, expect } from "vitest";
import { Effect, Layer, Stream, Duration, Ref } from "effect";
import * as AMQPConsumer from "../src/AMQPConsumer";
import * as AMQPProducer from "../src/AMQPProducer";
import * as AMQPConfig from "../src/AMQPConfig";

const testConfig = {
  url: "amqp://localhost:5672",
  heartbeat: 60,
  vhost: "/",
  username: "guest",
  password: "guest"
};

const configLayer = AMQPConfig.layer(testConfig);

describe("AMQP Integration Tests", () => {
  it("should handle end-to-end message flow", async () => {
    const queueName = `integration-test-${Date.now()}`;
    
    const consumerLayer = Layer.provide(
      AMQPConsumer.layerAMQPConfig({
        queue: queueName,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const producerLayer = Layer.provide(
      AMQPProducer.layerAMQPConfig({
        queue: queueName,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const testLayer = Layer.merge(consumerLayer, producerLayer);
    
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      // Test data
      const testMessages = [
        { id: "1", data: "First message", priority: 1 },
        { id: "2", data: "Second message", priority: 2 },
        { id: "3", data: "Third message", priority: 3 }
      ];
      
      // Track processed messages
      const processedMessages = yield* Ref.make<Array<{ id: string; data: string; priority: number }>>([]);
      
      // Start consumer
      const consumerFiber = yield* Effect.fork(
        consumer.stream({
          queue: queueName,
          queueOptions: { durable: true },
          consumeOptions: { noAck: false }
        }).pipe(
          Stream.take(testMessages.length),
          Stream.tap((message) =>
            Effect.gen(function* () {
              const body = message.bodyToString();
              const parsed = JSON.parse(body || "{}");
              
              yield* Ref.update(processedMessages, msgs => [...msgs, parsed]);
              yield* Effect.promise(() => message.ack());
            })
          ),
          Stream.runDrain
        )
      );
      
      // Wait for consumer to be ready
      yield* Effect.sleep(Duration.seconds(1));
      
      // Publish messages
      for (const msg of testMessages) {
        yield* producer.publish({
          message: JSON.stringify(msg),
          properties: {
            messageId: msg.id,
            priority: msg.priority,
            timestamp: new Date(),
            contentType: "application/json"
          }
        });
      }
      
      // Wait for all messages to be processed
      yield* Effect.sleep(Duration.seconds(5));
      
      const results = yield* Ref.get(processedMessages);
      
      expect(results).toHaveLength(testMessages.length);
      expect(results.map(r => r.id).sort()).toEqual(testMessages.map(m => m.id).sort());
    }).pipe(Effect.provide(testLayer));
    
    await Effect.runPromise(effect as Effect.Effect<void, any, never>);
  }, 15000);

  it("should handle high-throughput message processing", async () => {
    const queueName = `throughput-test-${Date.now()}`;
    
    const consumerLayer = Layer.provide(
      AMQPConsumer.layerAMQPConfig({
        queue: queueName,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const producerLayer = Layer.provide(
      AMQPProducer.layerAMQPConfig({
        queue: queueName,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const testLayer = Layer.merge(consumerLayer, producerLayer);
    
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const messageCount = 100;
      const processedCount = yield* Ref.make(0);
      
      // Start consumer
      const consumerFiber = yield* Effect.fork(
        consumer.stream({
          queue: queueName,
          queueOptions: { durable: true },
          consumeOptions: { noAck: true }  // Use auto-ack for better throughput
        }).pipe(
          Stream.take(messageCount),
          Stream.tap((message) =>
            Ref.update(processedCount, count => count + 1)
          ),
          Stream.runDrain
        )
      );
      
      // Wait for consumer to be ready
      yield* Effect.sleep(Duration.seconds(1));
      
      // Publish messages in batch
      const messages = Array.from({ length: messageCount }, (_, i) => ({
        message: `High throughput message ${i + 1}`,
        properties: { messageId: `msg-${i + 1}` }
      }));
      
      const startTime = Date.now();
      yield* producer.publishBatch(messages);
      
      // Wait for all messages to be processed
      yield* Effect.repeat(
        Ref.get(processedCount),
        { until: (count) => count >= messageCount }
      ).pipe(
        Effect.timeout(Duration.seconds(30))
      );
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      const throughput = messageCount / (duration / 1000);
      
      const finalCount = yield* Ref.get(processedCount);
      
      expect(finalCount).toBe(messageCount);
      expect(throughput).toBeGreaterThan(10); // At least 10 messages per second
      
      yield* Effect.logInfo(`Processed ${messageCount} messages in ${duration}ms (${throughput.toFixed(2)} msg/s)`);
    }).pipe(Effect.provide(testLayer));
    
    await Effect.runPromise(effect as Effect.Effect<void, any, never>);
  }, 35000);

  it("should handle concurrent producers and consumers", async () => {
    const queueName = `concurrent-test-${Date.now()}`;
    
    const consumerLayer = Layer.provide(
      AMQPConsumer.layerAMQPConfig({
        queue: queueName,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const producerLayer = Layer.provide(
      AMQPProducer.layerAMQPConfig({
        queue: queueName,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const testLayer = Layer.merge(consumerLayer, producerLayer);
    
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const messageCount = 50;
      const producerCount = 3;
      const consumerCount = 2;
      
      const processedMessages = yield* Ref.make<string[]>([]);
      
      // Start multiple consumers
      const consumerFibers = yield* Effect.all(
        Array.from({ length: consumerCount }, (_, i) =>
          Effect.fork(
            consumer.stream({
              queue: queueName,
              queueOptions: { durable: true },
              consumeOptions: { noAck: false }
            }).pipe(
              Stream.take(Math.ceil(messageCount / consumerCount)),
              Stream.tap((message) =>
                Effect.gen(function* () {
                  const body = message.bodyToString();
                  yield* Ref.update(processedMessages, msgs => [...msgs, body || ""]);
                  yield* Effect.promise(() => message.ack());
                })
              ),
              Stream.runDrain
            )
          )
        )
      );
      
      // Wait for consumers to be ready
      yield* Effect.sleep(Duration.seconds(1));
      
      // Start multiple producers
      yield* Effect.all(
        Array.from({ length: producerCount }, (_, producerId) =>
          Effect.gen(function* () {
            const messages = Array.from({ length: Math.ceil(messageCount / producerCount) }, (_, i) => ({
              message: `Producer ${producerId + 1} - Message ${i + 1}`,
              properties: { messageId: `p${producerId + 1}-m${i + 1}` }
            }));
            
            yield* producer.publishBatch(messages);
          })
        ),
        { concurrency: "unbounded" }
      );
      
      // Wait for all messages to be processed
      yield* Effect.repeat(
        Ref.get(processedMessages).pipe(Effect.map(msgs => msgs.length)),
        { until: (count) => count >= messageCount }
      ).pipe(
        Effect.timeout(Duration.seconds(30))
      );
      
      const results = yield* Ref.get(processedMessages);
      
      expect(results.length).toBeGreaterThanOrEqual(messageCount);
      
      // Verify all producers contributed
      for (let i = 1; i <= producerCount; i++) {
        const producerMessages = results.filter(msg => msg.includes(`Producer ${i}`));
        expect(producerMessages.length).toBeGreaterThan(0);
      }
    }).pipe(Effect.provide(testLayer));
    
    await Effect.runPromise(effect as Effect.Effect<void, any, never>);
  }, 35000);

  it("should handle message routing and filtering", async () => {
    const highPriorityQueue = `high-priority-${Date.now()}`;
    const lowPriorityQueue = `low-priority-${Date.now()}`;
    
    const highConsumerLayer = Layer.provide(
      AMQPConsumer.layerAMQPConfig({
        queue: highPriorityQueue,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const lowConsumerLayer = Layer.provide(
      AMQPConsumer.layerAMQPConfig({
        queue: lowPriorityQueue,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const producerLayer = Layer.provide(
      AMQPProducer.layerAMQPConfig({
        queue: highPriorityQueue, // Default queue
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const testLayer = Layer.mergeAll(
      highConsumerLayer,
      lowConsumerLayer,
      producerLayer
    );
    
    const effect = Effect.gen(function* () {
      const highConsumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const highPriorityMessages = yield* Ref.make<string[]>([]);
      const lowPriorityMessages = yield* Ref.make<string[]>([]);
      
      // Start high priority consumer
      const highConsumerFiber = yield* Effect.fork(
        highConsumer.stream({
          queue: highPriorityQueue,
          queueOptions: { durable: true },
          consumeOptions: { noAck: false }
        }).pipe(
          Stream.take(3),
          Stream.tap((message) =>
            Effect.gen(function* () {
              const body = message.bodyToString();
              yield* Ref.update(highPriorityMessages, msgs => [...msgs, body || ""]);
              yield* Effect.promise(() => message.ack());
            })
          ),
          Stream.runDrain
        )
      );
      
      // Start low priority consumer
      const lowConsumerFiber = yield* Effect.fork(
        highConsumer.stream({
          queue: lowPriorityQueue,
          queueOptions: { durable: true },
          consumeOptions: { noAck: false }
        }).pipe(
          Stream.take(2),
          Stream.tap((message) =>
            Effect.gen(function* () {
              const body = message.bodyToString();
              yield* Ref.update(lowPriorityMessages, msgs => [...msgs, body || ""]);
              yield* Effect.promise(() => message.ack());
            })
          ),
          Stream.runDrain
        )
      );
      
      // Wait for consumers to be ready
      yield* Effect.sleep(Duration.seconds(1));
      
      // Publish to different queues
      yield* producer.publish({
        queue: highPriorityQueue,
        message: "High priority message 1",
        properties: { priority: 9 }
      });
      
      yield* producer.publish({
        queue: highPriorityQueue,
        message: "High priority message 2",
        properties: { priority: 8 }
      });
      
      yield* producer.publish({
        queue: lowPriorityQueue,
        message: "Low priority message 1",
        properties: { priority: 1 }
      });
      
      yield* producer.publish({
        queue: highPriorityQueue,
        message: "High priority message 3",
        properties: { priority: 7 }
      });
      
      yield* producer.publish({
        queue: lowPriorityQueue,
        message: "Low priority message 2",
        properties: { priority: 2 }
      });
      
      // Wait for all messages to be processed
      yield* Effect.sleep(Duration.seconds(5));
      
      const highMessages = yield* Ref.get(highPriorityMessages);
      const lowMessages = yield* Ref.get(lowPriorityMessages);
      
      expect(highMessages).toHaveLength(3);
      expect(lowMessages).toHaveLength(2);
      
      expect(highMessages.every(msg => msg.includes("High priority"))).toBe(true);
      expect(lowMessages.every(msg => msg.includes("Low priority"))).toBe(true);
    }).pipe(Effect.provide(testLayer));
    
    await Effect.runPromise(effect as Effect.Effect<void, any, never>);
  }, 15000);

  it("should handle error recovery and retries", async () => {
    const queueName = `error-recovery-${Date.now()}`;
    
    const consumerLayer = Layer.provide(
      AMQPConsumer.layerAMQPConfig({
        queue: queueName,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const producerLayer = Layer.provide(
      AMQPProducer.layerAMQPConfig({
        queue: queueName,
        queueOptions: { durable: true }
      }),
      configLayer
    );
    
    const testLayer = Layer.merge(consumerLayer, producerLayer);
    
    const effect = Effect.gen(function* () {
      const consumer = yield* AMQPConsumer.AMQPConsumer;
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const processedMessages = yield* Ref.make<string[]>([]);
      const attemptCount = yield* Ref.make(0);
      
      // Publish a message
      yield* producer.publish({
        message: "Message requiring retry",
        properties: { messageId: "retry-test" }
      });
      
      // Consumer that fails initially, then succeeds
      yield* consumer.stream({
        queue: queueName,
        queueOptions: { durable: true },
        consumeOptions: { noAck: false }
      }).pipe(
        Stream.take(2), // Will take the original + redelivered message
        Stream.tap((message) =>
          Effect.gen(function* () {
            const body = message.bodyToString();
            const currentAttempt = yield* Ref.updateAndGet(attemptCount, count => count + 1);
            
            if (currentAttempt === 1) {
              // First attempt: fail (nack with requeue)
              yield* Effect.promise(() => message.nack(true));
            } else {
              // Second attempt: succeed
              yield* Ref.update(processedMessages, msgs => [...msgs, body || ""]);
              yield* Effect.promise(() => message.ack());
            }
          })
        ),
        Stream.runDrain,
        Effect.timeout(Duration.seconds(10))
      );
      
      const messages = yield* Ref.get(processedMessages);
      const attempts = yield* Ref.get(attemptCount);
      
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe("Message requiring retry");
      expect(attempts).toBe(2); // First attempt failed, second succeeded
    }).pipe(Effect.provide(testLayer));
    
    await Effect.runPromise(effect as Effect.Effect<void, any, never>);
  }, 15000);
});