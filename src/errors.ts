import { Data } from "effect";

export class AMQPError extends Data.TaggedError("AMQPError")<{
  error: unknown;
  operation?: string;
  context?: Record<string, unknown>;
}> {
  get message() {
    const parts: string[] = ["AMQP operation failed"];
    
    if (this.operation) {
      parts.push(`during ${this.operation}`);
    }
    
    const errorMessage = this.extractErrorMessage(this.error);
    if (errorMessage) {
      parts.push(`- ${errorMessage}`);
    }
    
    if (this.context && Object.keys(this.context).length > 0) {
      parts.push(`\nContext: ${JSON.stringify(this.context, null, 2)}`);
    }
    
    return parts.join(" ");
  }
  
  private extractErrorMessage(error: unknown): string | null {
    if (error instanceof Error) {
      return error.message;
    }
    
    if (typeof error === "string") {
      return error;
    }
    
    if (error && typeof error === "object" && "message" in error) {
      return String(error.message);
    }
    
    if (error && typeof error === "object" && "error" in error) {
      return this.extractErrorMessage((error as any).error);
    }
    
    return JSON.stringify(error);
  }
}