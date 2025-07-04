import {
  AMQPClient,
  AMQPMessage,
  type ConsumeParams,
  type QueueParams,
} from "@cloudamqp/amqp-client";
import { Config, Context, Effect, Layer, pipe, Stream } from "effect";
import * as AMQPConfig from "./AMQPConfig";
import { AMQPError } from "./errors";

export interface AMQPConsumerOptions {
  url: string;
  queue: string;
  queueOptions?: QueueParams;
  consumeOptions?: Partial<ConsumeParams>;
}

export interface AMQPConsumeOptions {
  queue: string;
  queueOptions?: QueueParams;
  consumeOptions?: Partial<ConsumeParams>;
}

export const make = (baseOptions: AMQPConsumerOptions) =>
  Effect.gen(function* () {
    const stream = (options: AMQPConsumeOptions) =>
      Stream.acquireRelease(
        Effect.promise(async () => {
          const client = new AMQPClient(baseOptions.url);
          const connection = await client.connect();
          const channel = await connection.channel();

          const queue = await channel.queue(
            options.queue,
            options.queueOptions || { durable: true }
          );

          return {
            client,
            connection,
            channel,
            queue,
          };
        }),
        ({ connection }) =>
          Effect.promise(async () => {
            await connection.close();
          }).pipe(
            Effect.tap(() => Effect.logDebug("AMQP connection closed")),
            Effect.catchAll((error) =>
              Effect.logError("Error closing AMQP connection", error)
            )
          )
      ).pipe(
        Stream.flatMap(({ queue }) =>
          Stream.asyncScoped<AMQPMessage, AMQPError>((emit) => {
            const consumer = queue.subscribe(
              options.consumeOptions || { noAck: false },
              (message: AMQPMessage) => {
                emit.single(message);
              }
            );

            consumer.catch((error) => {
              emit.fail(
                new AMQPError({
                  error,
                  operation: "consume",
                  context: { queue: options.queue },
                })
              );
            });

            return Effect.void;
          })
        )
      );

    return {
      stream,
    };
  });

export const makeWithConfig = (
  baseOptions: Omit<AMQPConsumerOptions, "url"> & { queue: string }
) =>
  Effect.gen(function* () {
    const config = yield* AMQPConfig.AMQPConfig;

    const stream = (options: AMQPConsumeOptions) =>
      Stream.acquireRelease(
        Effect.promise(async () => {
          const client = new AMQPClient(config.url);
          const connection = await client.connect();
          const channel = await connection.channel();

          const queue = await channel.queue(
            options.queue || baseOptions.queue,
            options.queueOptions ||
              baseOptions.queueOptions || { durable: true }
          );

          return {
            client,
            connection,
            channel,
            queue,
          };
        }),
        ({ connection }) =>
          Effect.promise(async () => {
            await connection.close();
          }).pipe(
            Effect.tap(() => Effect.logDebug("AMQP connection closed")),
            Effect.catchAll((error) =>
              Effect.logError("Error closing AMQP connection", error)
            )
          )
      ).pipe(
        Stream.flatMap(({ queue }) =>
          Stream.asyncScoped<AMQPMessage, AMQPError>((emit) => {
            const consumer = queue.subscribe(
              options.consumeOptions ||
                baseOptions.consumeOptions || { noAck: false },
              (message: AMQPMessage) => {
                emit.single(message);
              }
            );

            consumer.catch((error) => {
              emit.fail(
                new AMQPError({
                  error,
                  operation: "consume",
                  context: { queue: options.queue || baseOptions.queue },
                })
              );
            });

            return Effect.logDebug("Consumer subscription ended");
          })
        )
      );

    return {
      stream,
    };
  });

export class AMQPConsumer extends Context.Tag("AMQPConsumer")<
  AMQPConsumer,
  Effect.Effect.Success<ReturnType<typeof make>>
>() {}

export const layerAMQPConfig = (
  options: Omit<AMQPConsumerOptions, "url"> & { queue: string }
) => pipe(makeWithConfig(options), Layer.effect(AMQPConsumer));

export const layer = (options: AMQPConsumerOptions) =>
  Layer.effect(AMQPConsumer, make(options));

export const layerConfig = (config: Config.Config.Wrap<AMQPConsumerOptions>) =>
  pipe(config, Config.unwrap, Effect.flatMap(make), Layer.effect(AMQPConsumer));
