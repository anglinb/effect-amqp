import { Effect, Stream } from "effect";
import { AMQPConsumer } from "../src";
import { AMQPMessage } from "@cloudamqp/amqp-client";

const program = Effect.gen(function* () {
  const consumer = yield* AMQPConsumer.AMQPConsumer;

  const messageStream = consumer.stream({
    queue: "test-queue",
    queueOptions: { durable: true },
    consumeOptions: { noAck: false },
  });

  yield* messageStream.pipe(
    Stream.tap((message: AMQPMessage) =>
      Effect.gen(function* () {
        const body = message.bodyToString();
        yield* Effect.logInfo(`Received: ${body}`);
        yield* Effect.promise(() => message.ack());
      })
    ),
    Stream.take(5),
    Stream.runDrain
  );
});

const layer = AMQPConsumer.layer({
  url: "amqp://localhost:5672",
  queue: "test-queue",
  queueOptions: { durable: true },
});

Effect.runPromise(program.pipe(Effect.provide(layer))).catch(console.error);