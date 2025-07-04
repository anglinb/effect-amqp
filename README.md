# effect-amqp

A type-safe, functional AMQP client library built with [Effect](https://effect.website) for RabbitMQ and LavinMQ.

## Features

- 🔷 **Effect-based**: Leverages the power of Effect for type-safe, composable, and testable code
- 🚀 **High Performance**: Optimized for throughput with batching and streaming support
- 🛡️ **Type-Safe**: Full TypeScript support with detailed type inference
- 🔄 **Resource Safe**: Automatic connection management and cleanup
- 📊 **Streaming**: First-class support for streaming consumers with backpressure
- 🎯 **Flexible Acknowledgment**: Support for ack, nack, and reject with requeue options
- 🧪 **Well Tested**: Comprehensive test suite including integration and performance tests

## Installation

```bash
npm install effect-amqp effect @cloudamqp/amqp-client
# or
yarn add effect-amqp effect @cloudamqp/amqp-client
# or
pnpm add effect-amqp effect @cloudamqp/amqp-client
```

Note: `effect` is a peer dependency and must be installed separately.

## Quick Start

```typescript
import { Effect, Layer, Stream } from "effect";
import { AMQPConsumer, AMQPProducer, AMQPConfig } from "effect-amqp";

// Create configuration layer
const configLayer = AMQPConfig.layer({
  url: "amqp://localhost:5672",
  username: "guest",
  password: "guest",
  vhost: "/"
});

// Create producer and consumer layers
const producerLayer = Layer.provide(
  AMQPProducer.layerAMQPConfig({
    queue: "my-queue",
    queueOptions: { durable: true }
  }),
  configLayer
);

const consumerLayer = Layer.provide(
  AMQPConsumer.layerAMQPConfig({
    queue: "my-queue",
    queueOptions: { durable: true }
  }),
  configLayer
);

// Publish messages
const publishExample = Effect.gen(function* () {
  const producer = yield* AMQPProducer.AMQPProducer;
  
  // Publish a single message
  yield* producer.publish({
    message: "Hello, World!",
    properties: {
      contentType: "text/plain",
      timestamp: new Date()
    }
  });
  
  // Publish batch messages
  const messages = Array.from({ length: 10 }, (_, i) => ({
    message: `Message ${i}`,
    properties: { messageId: `msg-${i}` }
  }));
  
  yield* producer.publishBatch(messages);
});

// Consume messages
const consumeExample = Effect.gen(function* () {
  const consumer = yield* AMQPConsumer.AMQPConsumer;
  
  yield* consumer.stream({
    queue: "my-queue",
    queueOptions: { durable: true },
    consumeOptions: { noAck: false }
  }).pipe(
    Stream.tap((message) =>
      Effect.gen(function* () {
        console.log("Received:", message.bodyToString());
        // Process message...
        yield* Effect.promise(() => message.ack());
      })
    ),
    Stream.take(10),
    Stream.runDrain
  );
});

// Run the examples
const program = Effect.gen(function* () {
  yield* publishExample;
  yield* consumeExample;
}).pipe(
  Effect.provide(Layer.merge(producerLayer, consumerLayer))
);

Effect.runPromise(program);
```

## API Documentation

### AMQPConfig

Configuration module for AMQP connections.

```typescript
const config = AMQPConfig.layer({
  url: "amqp://localhost:5672",
  heartbeat: 60,
  vhost: "/",
  username: "guest",
  password: "guest",
  tlsOptions: {
    cert: "path/to/cert.pem",
    key: "path/to/key.pem",
    ca: ["path/to/ca.pem"]
  }
});
```

### AMQPProducer

Producer for publishing messages to AMQP queues.

```typescript
// Publish to a specific queue
yield* producer.publish({
  queue: "custom-queue",  // optional, uses default from layer
  message: "Hello",
  properties: {
    deliveryMode: 2,      // persistent
    priority: 5,
    contentType: "text/plain"
  }
});
```

### AMQPConsumer

Consumer for receiving messages from AMQP queues.

```typescript
// Consume with manual acknowledgment
consumer.stream({
  queue: "my-queue",
  queueOptions: { durable: true },
  consumeOptions: { 
    noAck: false,        // manual acknowledgment
    exclusive: false,
    consumerTag: "my-consumer"
  }
}).pipe(
  Stream.tap((message) =>
    Effect.gen(function* () {
      try {
        // Process message
        yield* Effect.promise(() => message.ack());
      } catch (error) {
        // Requeue on error
        yield* Effect.promise(() => message.nack(true));
      }
    })
  ),
  Stream.runDrain
);
```

### Error Handling

All AMQP operations can fail with `AMQPError`:

```typescript
import { AMQPError } from "effect-amqp";

Effect.gen(function* () {
  const result = yield* producer.publish({
    message: "test"
  }).pipe(
    Effect.catchTag("AMQPError", (error) =>
      Effect.logError(`AMQP operation failed: ${error.message}`)
    )
  );
});
```

## Message Acknowledgment

The library supports three acknowledgment methods:

1. **ack()**: Acknowledge successful processing
2. **nack(requeue)**: Negative acknowledgment with optional requeue
3. **reject(requeue)**: Reject message with optional requeue

```typescript
// Success case
yield* Effect.promise(() => message.ack());

// Retry case - message will be requeued
yield* Effect.promise(() => message.nack(true));

// Discard case - message will be removed
yield* Effect.promise(() => message.reject(false));
```

## Testing

The library includes comprehensive tests. To run them:

```bash
# Start RabbitMQ or LavinMQ using Docker
docker-compose up -d

# Run tests
npm test
```

## Performance

The library is optimized for high-throughput scenarios:

- Batch publishing for efficient message delivery
- Streaming consumers with backpressure handling
- Connection pooling and reuse
- Configurable acknowledgment strategies

Example throughput test achieving 300+ messages/second:

```typescript
const messages = Array.from({ length: 1000 }, (_, i) => ({
  message: `Message ${i}`,
  properties: { messageId: `msg-${i}` }
}));

yield* producer.publishBatch(messages);
```

## Development

### Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Start LavinMQ: `docker-compose up -d`
4. Run tests: `npm test`

### Scripts

- `npm run build` - Build the package
- `npm run typecheck` - Type check source files
- `npm run typecheck:all` - Type check all TypeScript files
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run linter (type checking)

### Releasing

This project uses automated releases via GitHub Actions. To create a new release:

1. **For a regular release:**
   ```bash
   ./scripts/release.sh [major|minor|patch]
   ```

2. **For a pre-release:**
   ```bash
   npm version prerelease --preid=beta
   git add package.json
   git commit -m "chore: bump version to pre-release"
   git tag "v$(node -p 'require("./package.json").version')"
   git push origin main --tags
   ```

The release process will:
- Run all tests
- Build the package
- Publish to npm with provenance
- Create a GitHub release

### GitHub Secrets Setup

For automated npm publishing, set up these repository secrets:

1. `NPM_TOKEN` - npm access token with publish permissions
   - Create at: https://www.npmjs.com/settings/tokens
   - Select "Automation" token type

2. `CODECOV_TOKEN` (optional) - for code coverage reporting
   - Get from: https://codecov.io/

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run `npm run lint` and `npm test`
6. Submit a pull request

## License

MIT
