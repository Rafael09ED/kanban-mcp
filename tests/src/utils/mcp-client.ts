import { ChildProcess } from 'child_process';

export interface McpRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: any;
}

export interface McpResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export interface McpToolCall {
  name: string;
  arguments: Record<string, any>;
}

export class McpClient {
  private requestId = 1;
  private server: ChildProcess;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

  constructor(server: ChildProcess) {
    this.server = server;
    this.setupResponseHandler();
  }

  private setupResponseHandler(): void {
    if (!this.server.stdout) {
      throw new Error('Server stdout not available');
    }

    this.server.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const response: McpResponse = JSON.parse(line);
          const pending = this.pendingRequests.get(response.id);
          
          if (pending) {
            this.pendingRequests.delete(response.id);
            
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (error) {
          // Ignore parsing errors for non-JSON output
        }
      }
    });
  }

  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request: McpRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      if (!this.server.stdin) {
        reject(new Error('Server stdin not available'));
        return;
      }

      const requestStr = JSON.stringify(request) + '\n';
      this.server.stdin.write(requestStr);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 5000);
    });
  }

  async listTools(): Promise<any> {
    return this.sendRequest('tools/list');
  }

  async callTool(toolCall: McpToolCall): Promise<any> {
    const result = await this.sendRequest('tools/call', {
      name: toolCall.name,
      arguments: toolCall.arguments
    });
    
    // Check if the result indicates an error
    if (result && result.isError) {
      const errorMessage = result.content && result.content[0] && result.content[0].text 
        ? result.content[0].text 
        : 'Unknown error';
      throw new Error(errorMessage);
    }
    
    return result;
  }
}
