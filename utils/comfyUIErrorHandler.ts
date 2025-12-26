/**
 * ComfyUI Error Handler
 * Provides user-friendly error messages for ComfyUI integration errors
 */

export class ComfyUIError extends Error {
  constructor(
    message: string,
    public code: string,
    public userMessage: string
  ) {
    super(message);
    this.name = 'ComfyUIError';
  }
}

/**
 * Maps error objects to user-friendly ComfyUIError instances
 */
export function handleComfyUIError(error: any): ComfyUIError {
  // Connection refused (ComfyUI not running)
  if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
    return new ComfyUIError(
      error.message || 'Connection refused',
      'CONNECTION_FAILED',
      'Cannot connect to ComfyUI. Make sure it is running at the configured URL.'
    );
  }

  // Timeout
  if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
    return new ComfyUIError(
      error.message || 'Request timed out',
      'TIMEOUT',
      'Request timed out. ComfyUI may be busy processing.'
    );
  }

  // Network error
  if (error.code === 'ENETUNREACH' || error.message?.includes('network')) {
    return new ComfyUIError(
      error.message || 'Network unreachable',
      'NETWORK_ERROR',
      'Network error. Check your connection and server URL.'
    );
  }

  // 404 Not Found (endpoint doesn't exist)
  if (error.status === 404 || error.message?.includes('404')) {
    return new ComfyUIError(
      error.message || 'Endpoint not found',
      'NOT_FOUND',
      'ComfyUI API endpoint not found. Make sure you are using a compatible ComfyUI version.'
    );
  }

  // 500 Internal Server Error
  if (error.status === 500 || error.message?.includes('500')) {
    return new ComfyUIError(
      error.message || 'Server error',
      'SERVER_ERROR',
      'ComfyUI server error. Check the ComfyUI console for details.'
    );
  }

  // WebSocket errors
  if (error.message?.includes('WebSocket')) {
    return new ComfyUIError(
      error.message,
      'WEBSOCKET_ERROR',
      'Lost connection to ComfyUI. Check if ComfyUI is still running.'
    );
  }

  // Invalid workflow
  if (error.message?.includes('workflow') || error.message?.includes('node')) {
    return new ComfyUIError(
      error.message,
      'INVALID_WORKFLOW',
      'Invalid workflow. The generated workflow may be incompatible with your ComfyUI installation.'
    );
  }

  // Generic/unknown error
  return new ComfyUIError(
    error.message || 'Unknown error',
    'UNKNOWN',
    `Unexpected error: ${error.message || 'Unknown error occurred'}`
  );
}
