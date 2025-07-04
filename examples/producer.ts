import { Effect } from "effect";
import { AMQPProducer } from "../src";

const program = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;

  // Send a single message
  yield* producer.publish({
    message: "Hello from Effect Producer!",
    properties: { timestamp: new Date() },
  });

  yield* Effect.logInfo("Single message sent!");

  // Send multiple messages
  const messages = Array.from({ length: 5 }, (_, i) => ({
    message: `Batch message ${i + 1}`,
    properties: { timestamp: new Date(), messageId: (i + 1).toString() },
  }));

  yield* producer.publishBatch(messages);

  yield* Effect.logInfo("Batch messages sent!");
});

const layer = AMQPProducer.layer({
  url: "amqp://localhost:5672",
  queue: "test-queue",
  queueOptions: { durable: true },
});

const runProgram = program.pipe(
  Effect.provide(layer),
  Effect.tapBoth({
    onFailure: (error) => Effect.logError("Producer failed", error),
    onSuccess: () => Effect.logInfo("Producer completed successfully")
  })
);

Effect.runPromise(runProgram).catch(console.error);