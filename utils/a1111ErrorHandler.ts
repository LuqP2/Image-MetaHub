export class A1111Error extends Error {
  constructor(
    message: string,
    public code: string,
    public userMessage: string
  ) {
    super(message);
    this.name = 'A1111Error';
  }
}

export function handleA1111Error(error: any): A1111Error {
  if (error.name === 'AbortError') {
    return new A1111Error(
      'Request timeout',
      'TIMEOUT',
      'Request timed out. A1111 may be busy processing. Please try again.'
    );
  }

  if (error.message?.includes('Failed to fetch')) {
    return new A1111Error(
      'Connection failed',
      'CONNECTION_FAILED',
      'Cannot connect to A1111. Make sure it\'s running with --api flag.'
    );
  }

  if (error.message?.includes('404')) {
    return new A1111Error(
      'API endpoint not found',
      'NOT_FOUND',
      'A1111 API endpoint not found. Update to latest version or check --api flag.'
    );
  }

  return new A1111Error(
    error.message,
    'UNKNOWN',
    'Unexpected error occurred. Check browser console for details.'
  );
}
