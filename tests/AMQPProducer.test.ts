import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import * as AMQPProducer from "../src/AMQPProducer";
import { AMQPError } from "../src/errors";

const testLayer = AMQPProducer.layer({
  url: "amqp://localhost:5672",
  queue: "test-producer-queue",
  queueOptions: { durable: true }
});

const runEffect = <A, E>(effect: Effect.Effect<A, E, AMQPProducer.AMQPProducer>) =>
  Effect.runPromise(effect.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>);

describe("AMQPProducer", () => {
  it("should publish a single message successfully", async () => {
    const effect = Effect.gen(function* () {
      const producer = yield* AMQPProducer.AMQPProducer;
      
      yield* producer.publish({
        message: "Hello, World!",
        properties: { timestamp: new Date() }
      });
      
      // Should complete without error
    });
    
    await runEffect(effect);
  });

  it("should publish messages with different data types", async () => {
    const effect = Effect.gen(function* () {
      const producer = yield* AMQPProducer.AMQPProducer;
      
      // Test string message
      yield* producer.publish({
        message: "String message"
      });
      
      // Test Uint8Array message
      const binaryData = new TextEncoder().encode("Binary message");
      yield* producer.publish({
        message: binaryData
      });
      
      // Test with properties
      yield* producer.publish({
        message: "Message with properties",
        properties: {
          contentType: "text/plain",
          deliveryMode: 2, // persistent
          priority: 5,
          timestamp: new Date()
        }
      });
    });
    
    await runEffect(effect);
  });

  it("should publish batch messages successfully", async () => {
    const effect = Effect.gen(function* () {
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const messages = Array.from({ length: 5 }, (_, i) => ({
        message: `Batch message ${i + 1}`,
        properties: { messageId: `msg-${i + 1}` }
      }));
      
      yield* producer.publishBatch(messages);
      
      // Should complete without error
    });
    
    await runEffect(effect);
  });

  it("should handle publishing to different queues", async () => {
    const effect = Effect.gen(function* () {
      const producer = yield* AMQPProducer.AMQPProducer;
      
      // Publish to override queue
      yield* producer.publish({
        queue: "different-queue",
        message: "Message to different queue"
      });
      
      // Publish to default queue
      yield* producer.publish({
        message: "Message to default queue"
      });
    });
    
    await runEffect(effect);
  });

  it("should handle empty batch gracefully", async () => {
    const effect = Effect.gen(function* () {
      const producer = yield* AMQPProducer.AMQPProducer;
      
      yield* producer.publishBatch([]);
      
      // Should complete without error
    });
    
    await runEffect(effect);
  });

  it("should fail with invalid URL", async () => {
    const invalidLayer = AMQPProducer.layer({
      url: "amqp://invalid-host:5672",
      queue: "test-queue",
      queueOptions: { durable: true }
    });
    
    const effect = Effect.gen(function* () {
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const result = yield* producer.publish({
        message: "This should fail"
      }).pipe(Effect.either);
      
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(AMQPError);
      }
    }).pipe(Effect.provide(invalidLayer));
    
    // This test expects to fail during connection
    await expect(Effect.runPromise(effect)).rejects.toThrow();
  });

  it("should preserve message properties", async () => {
    const effect = Effect.gen(function* () {
      const producer = yield* AMQPProducer.AMQPProducer;
      
      const testProperties = {
        contentType: "application/json",
        contentEncoding: "utf-8",
        deliveryMode: 2,
        priority: 8,
        correlationId: "test-correlation-id",
        replyTo: "reply-queue",
        expiration: "60000",
        messageId: "unique-message-id",
        timestamp: new Date(),
        type: "test-message",
        appId: "test-app"
      };
      
      yield* producer.publish({
        message: JSON.stringify({ test: "data" }),
        properties: testProperties
      });
      
      // Should complete without error
    });
    
    await runEffect(effect);
  });
});