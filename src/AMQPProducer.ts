import {
  AMQPClient,
  type AMQPProperties,
  type QueueParams,
} from "@cloudamqp/amqp-client";
import { Config, Context, Effect, Layer, pipe } from "effect";
import { AMQPError } from "./errors";
import * as AMQPConfig from "./AMQPConfig";

export interface AMQPProducerOptions {
  url: string;
  queue: string;
  queueOptions?: QueueParams;
}

export interface AMQPPublishOptions {
  queue?: string;
  message: string | Uint8Array;
  properties?: Partial<AMQPProperties>;
  routingKey?: string;
  exchange?: string;
}

export const make = (baseOptions: AMQPProducerOptions) =>
  Effect.gen(function* () {
    const publish = (options: AMQPPublishOptions) =>
      Effect.acquireUseRelease(
        Effect.promise(async () => {
          const client = new AMQPClient(baseOptions.url);
          const connection = await client.connect();
          const channel = await connection.channel();
          
          const queueName = options.queue || baseOptions.queue;
          const queue = await channel.queue(
            queueName,
            baseOptions.queueOptions || { durable: true }
          );
          
          return {
            client,
            connection,
            channel,
            queue,
          };
        }),
        ({ queue }) =>
          Effect.promise(async () => {
            await queue.publish(
              options.message,
              options.properties || {}
            );
          }).pipe(
            Effect.mapError((error) => 
              new AMQPError({
                error,
                operation: "publish",
                context: { 
                  queue: options.queue || baseOptions.queue,
                  messageSize: typeof options.message === 'string' 
                    ? options.message.length 
                    : options.message.length
                }
              })
            )
          ),
        ({ connection }) =>
          Effect.promise(async () => {
            await connection.close();
          }).pipe(
            Effect.catchAll((error) =>
              Effect.logError("Error closing AMQP connection", error)
            )
          )
      );

    const publishBatch = (messages: AMQPPublishOptions[]) =>
      Effect.acquireUseRelease(
        Effect.promise(async () => {
          const client = new AMQPClient(baseOptions.url);
          const connection = await client.connect();
          const channel = await connection.channel();
          
          const queueName = baseOptions.queue;
          const queue = await channel.queue(
            queueName,
            baseOptions.queueOptions || { durable: true }
          );
          
          return {
            client,
            connection,
            channel,
            queue,
          };
        }),
        ({ queue }) =>
          Effect.forEach(messages, (options) =>
            Effect.promise(async () => {
              await queue.publish(
                options.message,
                options.properties || {}
              );
            }).pipe(
              Effect.mapError((error) => 
                new AMQPError({
                  error,
                  operation: "publish_batch",
                  context: { 
                    queue: options.queue || baseOptions.queue,
                    messageSize: typeof options.message === 'string' 
                      ? options.message.length 
                      : options.message.length
                  }
                })
              )
            )
          ).pipe(
            Effect.mapError((error) => 
              new AMQPError({
                error,
                operation: "publish_batch",
                context: { 
                  queue: baseOptions.queue,
                  batchSize: messages.length
                }
              })
            )
          ),
        ({ connection }) =>
          Effect.promise(async () => {
            await connection.close();
          }).pipe(
            Effect.catchAll((error) =>
              Effect.logError("Error closing AMQP connection", error)
            )
          )
      );

    return {
      publish,
      publishBatch,
    };
  });

export const makeWithConfig = (
  baseOptions: Omit<AMQPProducerOptions, "url"> & { queue: string }
) =>
  Effect.gen(function* () {
    const config = yield* AMQPConfig.AMQPConfig;
    
    const publish = (options: AMQPPublishOptions) =>
      Effect.acquireUseRelease(
        Effect.promise(async () => {
          const client = new AMQPClient(config.url);
          const connection = await client.connect();
          const channel = await connection.channel();
          
          const queueName = options.queue || baseOptions.queue;
          const queue = await channel.queue(
            queueName,
            baseOptions.queueOptions || { durable: true }
          );
          
          return {
            client,
            connection,
            channel,
            queue,
          };
        }),
        ({ queue }) =>
          Effect.promise(async () => {
            await queue.publish(
              options.message,
              options.properties || {}
            );
          }).pipe(
            Effect.mapError((error) => 
              new AMQPError({
                error,
                operation: "publish",
                context: { 
                  queue: options.queue || baseOptions.queue,
                  messageSize: typeof options.message === 'string' 
                    ? options.message.length 
                    : options.message.length
                }
              })
            )
          ),
        ({ connection }) =>
          Effect.promise(async () => {
            await connection.close();
          }).pipe(
            Effect.catchAll((error) =>
              Effect.logError("Error closing AMQP connection", error)
            )
          )
      );

    const publishBatch = (messages: AMQPPublishOptions[]) =>
      Effect.acquireUseRelease(
        Effect.promise(async () => {
          const client = new AMQPClient(config.url);
          const connection = await client.connect();
          const channel = await connection.channel();
          
          const queueName = baseOptions.queue;
          const queue = await channel.queue(
            queueName,
            baseOptions.queueOptions || { durable: true }
          );
          
          return {
            client,
            connection,
            channel,
            queue,
          };
        }),
        ({ queue }) =>
          Effect.forEach(messages, (options) =>
            Effect.promise(async () => {
              await queue.publish(
                options.message,
                options.properties || {}
              );
            }).pipe(
              Effect.mapError((error) => 
                new AMQPError({
                  error,
                  operation: "publish_batch",
                  context: { 
                    queue: options.queue || baseOptions.queue,
                    messageSize: typeof options.message === 'string' 
                      ? options.message.length 
                      : options.message.length
                  }
                })
              )
            )
          ).pipe(
            Effect.mapError((error) => 
              new AMQPError({
                error,
                operation: "publish_batch",
                context: { 
                  queue: baseOptions.queue,
                  batchSize: messages.length
                }
              })
            )
          ),
        ({ connection }) =>
          Effect.promise(async () => {
            await connection.close();
          }).pipe(
            Effect.catchAll((error) =>
              Effect.logError("Error closing AMQP connection", error)
            )
          )
      );

    return {
      publish,
      publishBatch,
    };
  });

export class AMQPProducer extends Context.Tag("AMQPProducer")<
  AMQPProducer,
  Effect.Effect.Success<ReturnType<typeof make>>
>() {}

export const layerAMQPConfig = (
  options: Omit<AMQPProducerOptions, "url"> & { queue: string }
) =>
  pipe(
    makeWithConfig(options),
    Layer.effect(AMQPProducer)
  );

export const layer = (options: AMQPProducerOptions) =>
  Layer.effect(AMQPProducer, make(options));

export const layerConfig = (
  config: Config.Config.Wrap<AMQPProducerOptions>
) =>
  pipe(
    config,
    Config.unwrap,
    Effect.flatMap(make),
    Layer.effect(AMQPProducer)
  );