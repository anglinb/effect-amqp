# LavinMQ Effect Tests

This directory contains comprehensive tests for the Effect-based LavinMQ client library.

## Test Structure

### Test Files

- **`AMQPProducer.test.ts`** - Tests for message publishing functionality
- **`AMQPConsumer.test.ts`** - Tests for message consumption functionality  
- **`acknowledgement.test.ts`** - Critical tests for message acknowledgement behavior
- **`integration.test.ts`** - End-to-end integration tests
- **`setup/global.ts`** - Global test setup (Docker Compose management)
- **`utils/test-helpers.ts`** - Test utility functions

## Key Test Scenarios

### AMQPProducer Tests
- Single message publishing
- Batch message publishing
- Different data types (string, Uint8Array)
- Message properties handling
- Error scenarios (invalid connections)
- Queue routing

### AMQPConsumer Tests
- Basic message consumption
- Multiple consumers
- Stream interruption handling
- Different consume options
- Queue creation and management

### Acknowledgement Tests (Critical)
These tests verify the AMQP reliability guarantees:

1. **Requeue on Consumer Death** - Simulates a consumer dying before acknowledgement
2. **Proper Acknowledgement** - Verifies messages are not requeued when properly acked
3. **NACK with Requeue** - Tests negative acknowledgement with requeue
4. **Reject without Requeue** - Tests message rejection (discard)

### Integration Tests
- High-throughput processing
- Concurrent producers and consumers
- Message routing and filtering
- Error recovery and retries
- End-to-end message flow

## Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run with coverage
bun test:coverage

# Run specific test file
bun test AMQPProducer.test.ts
```

## Test Environment

### Prerequisites
- Docker Desktop must be running
- LavinMQ container will be automatically started via global setup

### Global Setup
The test suite automatically:
1. Starts LavinMQ container using `docker-compose up -d`
2. Waits for LavinMQ to be ready (health check)
3. Runs all tests
4. Cleans up the container after tests complete

### LavinMQ Configuration
- **AMQP Port**: 5672
- **Management UI**: http://localhost:15672
- **Credentials**: guest/guest
- **Container**: `cloudamqp/lavinmq:latest`

## Test Patterns

### Effect Testing with @effect/vitest
All tests use Effect's testing utilities:

```typescript
import { describe, it, expect } from "@effect/vitest";

it.effect("test name", () => 
  Effect.gen(function* () {
    // Test implementation using Effect
  }).pipe(Effect.provide(testLayer))
);
```

### Test Isolation
Each test uses unique queue names to prevent interference:
```typescript
const queueName = `test-${Date.now()}`;
```

### Resource Management
Tests properly handle resource cleanup using Effect's resource management:
- Automatic connection cleanup
- Fiber interruption for testing consumer failures
- Proper acknowledgement/nack handling

## Important Test Cases

### Message Redelivery Test
The most critical test simulates a consumer dying before acknowledgement:

1. Consumer receives message
2. Consumer is killed (fiber interrupted) before `ack()`
3. Message should be redelivered to new consumer
4. Redelivered message has `redelivered: true` flag

This validates AMQP's at-least-once delivery guarantee.

### High Throughput Test
Verifies the library can handle high message volumes:
- 100+ messages published in batch
- Multiple concurrent consumers
- Throughput measurement
- Memory usage monitoring

## Debugging Tests

### Logs
Effect logging is enabled during tests. Check console output for:
- Connection events
- Message processing logs
- Error details

### LavinMQ Management UI
Access http://localhost:15672 during test runs to:
- Monitor queue states
- View message counts
- Debug connection issues

### Docker Logs
```bash
docker-compose logs lavinmq
```