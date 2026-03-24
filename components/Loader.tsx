
import React from 'react';

interface LoaderProps {
  progress: {
    current: number;
    total: number;

  } | null;
}

const Loader: React.FC<LoaderProps> = ({ progress }) => {
  const percentage = progress && progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const isDeterminate = Boolean(progress && progress.total > 0);
  const title = isDeterminate ? 'Loading Library...' : 'Preparing Library...';
  const description = isDeterminate
    ? 'Please wait while we prepare your images and metadata.'
    : 'Loading cached images and preparing the first thumbnails.';

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8">
      <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div>
      <h2 className="text-2xl font-semibold mb-2 text-gray-100">{title}</h2>
      <p className="text-gray-400 mb-4">
        {description}
      </p>
      {isDeterminate && (
        <div className="w-full max-w-md bg-gray-700 rounded-full h-4">
          <div
            className="bg-blue-500 h-4 rounded-full transition-all duration-300 ease-linear"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      )}
      {isDeterminate && (
        <p className="mt-2 text-sm text-gray-400 font-mono">
          {progress!.current} / {progress!.total} items loaded
        </p>
      )}
    </div>
  );
};

export default Loader;
