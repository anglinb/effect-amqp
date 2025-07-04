import { Effect, Layer, Stream, Console } from "effect";
import { AMQPConsumer, AMQPProducer, AMQPConfig } from "../src";
import { AMQPMessage } from "@cloudamqp/amqp-client";

// Configuration layer - shared between producer and consumer
const configLayer = AMQPConfig.layer({
  url: process.env.AMQP_URL || "amqp://localhost:5672",
  username: process.env.AMQP_USERNAME || "guest",
  password: process.env.AMQP_PASSWORD || "guest",
  vhost: process.env.AMQP_VHOST || "/"
});

// Example 1: Simple producer
const simpleProducer = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;
  
  // Send a simple message
  yield* producer.publish({
    message: "Hello from Effect-AMQP!",
    properties: {
      contentType: "text/plain",
      timestamp: new Date()
    }
  });
  
  yield* Console.log("Message sent successfully!");
});

// Example 2: Batch producer
const batchProducer = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;
  
  // Create 100 messages
  const messages = Array.from({ length: 100 }, (_, i) => ({
    message: JSON.stringify({ 
      id: i, 
      content: `Batch message ${i}`,
      timestamp: new Date().toISOString()
    }),
    properties: {
      contentType: "application/json",
      messageId: `batch-${i}`
    }
  }));
  
  yield* producer.publishBatch(messages);
  yield* Console.log(`Sent ${messages.length} messages in batch`);
});

// Example 3: Consumer with acknowledgment
const consumer = Effect.gen(function* () {
  const consumer = yield* AMQPConsumer.AMQPConsumer;
  
  yield* Console.log("Starting consumer...");
  
  yield* consumer.stream({
    queue: "example-queue",
    queueOptions: { 
      durable: true,
      autoDelete: false
    },
    consumeOptions: { 
      noAck: false // Manual acknowledgment
    }
  }).pipe(
    Stream.tap((message: AMQPMessage) =>
      Effect.gen(function* () {
        const body = message.bodyToString();
        yield* Console.log(`Received: ${body}`);
        
        try {
          // Process the message
          const data = JSON.parse(body || "{}");
          yield* Console.log(`Processing message with ID: ${data.id}`);
          
          // Acknowledge successful processing
          yield* Effect.promise(() => message.ack());
        } catch (error) {
          yield* Console.error(`Error processing message: ${error}`);
          // Requeue the message for retry
          yield* Effect.promise(() => message.nack(true));
        }
      })
    ),
    Stream.take(10), // Process 10 messages then stop
    Stream.runDrain
  );
  
  yield* Console.log("Consumer finished");
});

// Example 4: Error handling
const errorHandlingExample = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;
  
  const result = yield* producer.publish({
    message: "Test message"
  }).pipe(
    Effect.map(() => "Success!" as const),
    Effect.catchTag("AMQPError", (error) => 
      Effect.succeed(`Failed: ${error.message}` as const)
    )
  );
  
  yield* Console.log(result);
});

// Create layers
const producerLayer = Layer.provide(
  AMQPProducer.layerAMQPConfig({
    queue: "example-queue",
    queueOptions: { durable: true }
  }),
  configLayer
);

const consumerLayer = Layer.provide(
  AMQPConsumer.layerAMQPConfig({
    queue: "example-queue",
    queueOptions: { durable: true }
  }),
  configLayer
);

const appLayer = Layer.merge(producerLayer, consumerLayer);

// Main program that runs all examples
const program = Effect.gen(function* () {
  // Run examples
  yield* Console.log("=== Running Simple Producer ===");
  yield* simpleProducer;
  
  yield* Console.log("\n=== Running Batch Producer ===");
  yield* batchProducer;
  
  yield* Console.log("\n=== Running Consumer ===");
  yield* consumer;
  
  yield* Console.log("\n=== Running Error Handling Example ===");
  yield* errorHandlingExample;
});

// Run the program with the layer
Effect.runPromise(program.pipe(Effect.provide(appLayer))).catch(console.error);