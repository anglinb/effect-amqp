import { Effect, Layer, Stream, Duration, Schedule, Ref, Fiber } from "effect";
import { AMQPConsumer, AMQPProducer, AMQPConfig } from "../src";
import { AMQPMessage } from "@cloudamqp/amqp-client";

// Configuration
const configLayer = AMQPConfig.layer({
  url: "amqp://localhost:5672",
  username: "guest",
  password: "guest",
  vhost: "/"
});

// Example 1: Dead Letter Queue Pattern
const deadLetterExample = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;
  const consumer = yield* AMQPConsumer.AMQPConsumer;
  
  const mainQueue = "main-queue";
  const dlQueue = "dead-letter-queue";
  const maxRetries = 3;
  
  // Process messages with retry logic
  yield* consumer.stream({
    queue: mainQueue,
    queueOptions: { durable: true },
    consumeOptions: { noAck: false }
  }).pipe(
    Stream.tap((message: AMQPMessage) =>
      Effect.gen(function* () {
        const body = message.bodyToString();
        const retryCountHeader = message.properties.headers?.["x-retry-count"];
        const retryCount = typeof retryCountHeader === 'number' ? retryCountHeader : 0;
        
        try {
          // Simulate processing that might fail
          if (Math.random() < 0.3) {
            throw new Error("Random processing error");
          }
          
          yield* Effect.logInfo(`Successfully processed: ${body}`);
          yield* Effect.promise(() => message.ack());
        } catch (error) {
          if (retryCount < maxRetries) {
            // Requeue with incremented retry count
            yield* producer.publish({
              queue: mainQueue,
              message: body || "",
              properties: {
                ...message.properties,
                headers: {
                  ...message.properties.headers,
                  "x-retry-count": retryCount + 1
                }
              }
            });
            yield* Effect.logWarning(`Retrying message (attempt ${retryCount + 1}/${maxRetries})`);
            yield* Effect.promise(() => message.ack()); // Remove from current queue
          } else {
            // Send to dead letter queue
            yield* producer.publish({
              queue: dlQueue,
              message: body || "",
              properties: {
                ...message.properties,
                headers: {
                  ...message.properties.headers,
                  "x-original-error": String(error),
                  "x-failed-after-retries": maxRetries
                }
              }
            });
            yield* Effect.logError(`Message sent to DLQ after ${maxRetries} retries`);
            yield* Effect.promise(() => message.ack());
          }
        }
      })
    ),
    Stream.take(10),
    Stream.runDrain
  );
});

// Example 2: Work Queue with Rate Limiting
const rateLimitedWorker = Effect.gen(function* () {
  const consumer = yield* AMQPConsumer.AMQPConsumer;
  const processedCount = yield* Ref.make(0);
  
  // Rate limit: 5 messages per second
  const schedule = Schedule.fixed(Duration.millis(200));
  
  yield* consumer.stream({
    queue: "rate-limited-queue",
    queueOptions: { durable: true },
    consumeOptions: { noAck: false }
  }).pipe(
    Stream.tap((message: AMQPMessage) =>
      Effect.gen(function* () {
        // Process with rate limiting
        yield* Effect.sleep(Duration.millis(200));
        
        const body = message.bodyToString();
        yield* Effect.logInfo(`Processing rate-limited: ${body}`);
        yield* Ref.update(processedCount, n => n + 1);
        yield* Effect.promise(() => message.ack());
      })
    ),
    Stream.schedule(schedule),
    Stream.take(20),
    Stream.runDrain
  );
  
  const total = yield* Ref.get(processedCount);
  yield* Effect.logInfo(`Processed ${total} messages with rate limiting`);
});

// Example 3: Pub/Sub Pattern with Topics
const pubSubExample = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;
  
  // Simulate different event types
  const events = [
    { type: "user.created", data: { id: 1, name: "Alice" } },
    { type: "user.updated", data: { id: 1, name: "Alice Smith" } },
    { type: "order.created", data: { id: 100, userId: 1, total: 99.99 } },
    { type: "user.deleted", data: { id: 2 } },
    { type: "order.shipped", data: { id: 100, trackingNumber: "ABC123" } }
  ];
  
  // Publish events to different queues based on type
  yield* Effect.forEach(events, (event) =>
    producer.publish({
      queue: `events.${event.type}`,
      message: JSON.stringify(event.data),
      properties: {
        contentType: "application/json",
        type: event.type,
        timestamp: new Date()
      }
    }).pipe(
      Effect.tap(() => Effect.logInfo(`Published ${event.type} event`))
    )
  );
});

// Example 4: Request-Reply Pattern
const requestReplyExample = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;
  const consumer = yield* AMQPConsumer.AMQPConsumer;
  
  const requestQueue = "rpc-request";
  const replyQueue = "rpc-reply";
  const correlationId = `rpc-${Date.now()}`;
  
  // Start reply listener
  const replyFiber = yield* Effect.fork(
    consumer.stream({
      queue: replyQueue,
      queueOptions: { durable: false, autoDelete: true },
      consumeOptions: { noAck: true }
    }).pipe(
      Stream.filter((message: AMQPMessage) => 
        message.properties.correlationId === correlationId
      ),
      Stream.take(1),
      Stream.tap((message: AMQPMessage) =>
        Effect.logInfo(`Received reply: ${message.bodyToString()}`)
      ),
      Stream.runDrain
    )
  );
  
  // Send request
  yield* producer.publish({
    queue: requestQueue,
    message: JSON.stringify({ method: "calculate", params: [10, 20] }),
    properties: {
      replyTo: replyQueue,
      correlationId,
      contentType: "application/json"
    }
  });
  
  yield* Effect.logInfo(`Sent RPC request with correlationId: ${correlationId}`);
  
  // Wait for reply
  yield* Fiber.join(replyFiber);
});

// Example 5: Circuit Breaker Pattern
const circuitBreakerExample = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;
  
  const failures = yield* Ref.make(0);
  const circuitOpen = yield* Ref.make(false);
  const threshold = 3;
  
  const sendWithCircuitBreaker = (message: string) =>
    Effect.gen(function* () {
      const isOpen = yield* Ref.get(circuitOpen);
      
      if (isOpen) {
        yield* Effect.fail(new Error("Circuit breaker is open"));
      }
      
      const result = yield* producer.publish({
        message,
        properties: { timestamp: new Date() }
      }).pipe(
        Effect.tap(() => Ref.set(failures, 0)), // Reset on success
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const failCount = yield* Ref.updateAndGet(failures, n => n + 1);
            
            if (failCount >= threshold) {
              yield* Ref.set(circuitOpen, true);
              yield* Effect.logError(`Circuit breaker opened after ${threshold} failures`);
              
              // Reset circuit after 5 seconds
              yield* Effect.fork(
                Effect.sleep(Duration.seconds(5)).pipe(
                  Effect.tap(() => Ref.set(circuitOpen, false)),
                  Effect.tap(() => Ref.set(failures, 0)),
                  Effect.tap(() => Effect.logInfo("Circuit breaker reset"))
                )
              );
            }
            
            yield* Effect.fail(error);
          })
        )
      );
      
      return result;
    });
  
  // Test circuit breaker
  const messages = Array.from({ length: 10 }, (_, i) => `Message ${i}`);
  
  yield* Effect.forEach(
    messages,
    (msg) => sendWithCircuitBreaker(msg).pipe(
      Effect.catchAll((error) => Effect.logWarning(`Failed to send: ${error.message}`))
    ),
    { concurrency: 1 }
  );
});

// Create and compose layers
const producerLayer = Layer.provide(
  AMQPProducer.layerAMQPConfig({
    queue: "default-queue",
    queueOptions: { durable: true }
  }),
  configLayer
);

const consumerLayer = Layer.provide(
  AMQPConsumer.layerAMQPConfig({
    queue: "default-queue",
    queueOptions: { durable: true }
  }),
  configLayer
);

const appLayer = Layer.merge(producerLayer, consumerLayer);

// Main program
const program = Effect.gen(function* () {
  yield* Effect.logInfo("=== Dead Letter Queue Pattern ===");
  yield* deadLetterExample.pipe(
    Effect.catchAll((error) => Effect.logError("DLQ example failed", error))
  );
  
  yield* Effect.logInfo("\n=== Rate Limited Worker ===");
  yield* rateLimitedWorker.pipe(
    Effect.catchAll((error) => Effect.logError("Rate limiter failed", error))
  );
  
  yield* Effect.logInfo("\n=== Pub/Sub Pattern ===");
  yield* pubSubExample.pipe(
    Effect.catchAll((error) => Effect.logError("Pub/Sub failed", error))
  );
  
  yield* Effect.logInfo("\n=== Request-Reply Pattern ===");
  yield* requestReplyExample.pipe(
    Effect.catchAll((error) => Effect.logError("RPC failed", error))
  );
  
  yield* Effect.logInfo("\n=== Circuit Breaker Pattern ===");
  yield* circuitBreakerExample.pipe(
    Effect.catchAll((error) => Effect.logError("Circuit breaker failed", error))
  );
});

// Run with proper error handling
Effect.runPromise(
  program.pipe(
    Effect.provide(appLayer),
    Effect.tapBoth({
      onFailure: (error) => Effect.logError("Program failed", error),
      onSuccess: () => Effect.logInfo("All examples completed successfully")
    })
  )
).catch(console.error);