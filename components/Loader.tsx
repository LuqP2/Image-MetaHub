
import React from 'react';

interface LoaderProps {
  progress: {
    current: number;
    total: number;
  };
}

const Loader: React.FC<LoaderProps> = ({ progress }) => {
  const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8">
      <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div>
      <h2 className="text-2xl font-semibold mb-2 text-gray-100">Indexing Images...</h2>
      <p className="text-gray-400 mb-4">
        Please wait while we scan your folder. This might take a few moments for large collections.
      </p>
      {progress.total > 0 && (
        <div className="w-full max-w-md bg-gray-700 rounded-full h-4">
          <div
            className="bg-blue-500 h-4 rounded-full transition-all duration-300 ease-linear"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      )}
      <p className="mt-2 text-sm text-gray-400 font-mono">
        {progress.current} / {progress.total} files processed
      </p>
    </div>
  );
};

export default Loader;
