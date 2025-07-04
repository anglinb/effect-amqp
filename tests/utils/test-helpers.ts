import { Effect, Layer } from "effect";
import * as AMQPProducer from "../../src/AMQPProducer";
import * as AMQPConsumer from "../../src/AMQPConsumer";
import * as AMQPConfig from "../../src/AMQPConfig";

export const createTestConfig = () => ({
  url: "amqp://localhost:5672",
  heartbeat: 60,
  vhost: "/",
  username: "guest",
  password: "guest"
});

export const createTestLayers = (queueName: string) => {
  const config = createTestConfig();
  const configLayer = AMQPConfig.layer(config);
  
  const consumerLayer = AMQPConsumer.layerAMQPConfig({
    queue: queueName,
    queueOptions: { durable: true }
  });
  
  const producerLayer = AMQPProducer.layerAMQPConfig({
    queue: queueName,
    queueOptions: { durable: true }
  });
  
  return {
    configLayer,
    consumerLayer,
    producerLayer,
    combinedLayer: Layer.mergeAll(configLayer, consumerLayer, producerLayer)
  };
};

export const generateUniqueQueueName = (prefix: string = "test") => 
  `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

export const waitForCondition = <T>(
  condition: Effect.Effect<T, never, never>,
  predicate: (value: T) => boolean,
  maxAttempts: number = 30,
  delayMs: number = 100
) =>
  Effect.gen(function* () {
    for (let i = 0; i < maxAttempts; i++) {
      const value = yield* condition;
      if (predicate(value)) {
        return value;
      }
      yield* Effect.sleep(delayMs);
    }
    return yield* Effect.fail(new Error(`Condition not met after ${maxAttempts} attempts`));
  });

export const createTestMessage = (id: string, data?: any) => ({
  message: JSON.stringify({ id, data, timestamp: Date.now() }),
  properties: {
    messageId: id,
    timestamp: new Date(),
    contentType: "application/json"
  }
});