import { execSync } from "child_process";
import { Effect } from "effect";

export async function setup() {
  console.log("🚀 Starting LavinMQ container for tests...");
  
  try {
    // Check if Docker is running
    execSync("docker info", { stdio: "ignore" });
  } catch (error) {
    throw new Error("Docker is not running. Please start Docker Desktop and try again.");
  }

  try {
    // Stop any existing container
    execSync("docker compose down", { stdio: "ignore" });
  } catch {
    // Ignore if no container was running
  }

  try {
    // Start LavinMQ container
    execSync("docker compose up -d", { stdio: "inherit" });
    
    // Wait for LavinMQ to be ready
    console.log("⏳ Waiting for LavinMQ to be ready...");
    
    let retries = 30;
    while (retries > 0) {
      try {
        // Try to connect to the management API
        const response = await fetch("http://localhost:15672/api/overview", {
          method: "GET",
          headers: {
            "Authorization": "Basic " + Buffer.from("guest:guest").toString("base64")
          }
        });
        
        if (response.ok) {
          console.log("✅ LavinMQ is ready!");
          return;
        }
      } catch {
        // Connection failed, retry
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries--;
    }
    
    throw new Error("LavinMQ failed to start within 30 seconds");
  } catch (error) {
    console.error("❌ Failed to start LavinMQ:", error);
    throw error;
  }
}

export async function teardown() {
  console.log("🧹 Cleaning up LavinMQ container...");
  
  try {
    execSync("docker compose down", { stdio: "inherit" });
    console.log("✅ LavinMQ container stopped");
  } catch (error) {
    console.error("❌ Failed to stop LavinMQ container:", error);
  }
}