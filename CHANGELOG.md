# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2024-07-04

### Added
- Initial release of effect-amqp
- AMQPConfig module for connection configuration
- AMQPProducer module with single and batch publishing
- AMQPConsumer module with streaming support
- AMQPError class for comprehensive error handling
- Support for message acknowledgment (ack, nack, reject)
- Resource-safe connection management
- Comprehensive test suite with integration tests
- Docker Compose setup for testing
- Examples demonstrating basic and advanced patterns:
  - Simple producer/consumer
  - Dead letter queue pattern
  - Rate-limited workers
  - Pub/Sub pattern
  - Request-Reply (RPC) pattern
  - Circuit breaker pattern

### Features
- Effect-based functional programming approach
- Type-safe APIs with full TypeScript support
- Streaming consumers with backpressure handling
- Batch message publishing for high throughput
- Configurable queue options and consume parameters
- TLS/SSL support for secure connections
- Comprehensive error handling and recovery patterns

### Dependencies
- `effect` (peer dependency) - Functional effect system
- `@cloudamqp/amqp-client` - AMQP client library

[unreleased]: https://github.com/anglinb/effect-amqp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/anglinb/effect-amqp/releases/tag/v0.1.0