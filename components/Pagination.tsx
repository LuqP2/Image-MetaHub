import React, { useState, useEffect } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (items: number) => void;
  totalItems: number;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  itemsPerPage,
  onItemsPerPageChange,
  totalItems
}) => {
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState(currentPage.toString());

  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handlePageInputSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    let newPage = parseInt(pageInput, 10);
    if (!isNaN(newPage)) {
      newPage = Math.max(1, Math.min(newPage, totalPages));
      onPageChange(newPage);
    }
    setIsEditingPage(false);
  };

  const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onItemsPerPageChange(parseInt(value, 10));
  };

  const showPageControls = totalPages > 1;

  return (
    <div className="flex justify-center items-center gap-4 mt-6 py-4 text-gray-400">
      {/* Items per page dropdown */}
      <div className="flex items-center gap-2">
        <label htmlFor="items-per-page" className="text-sm">Show:</label>
        <select
          id="items-per-page"
          value={itemsPerPage}
          onChange={handleItemsPerPageChange}
          className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>

      {showPageControls && (
        <>
          <div className="flex-grow" />

          {/* Page navigation */}
          <div className="flex items-center gap-3">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="px-3 py-1 bg-gray-700 rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          title="First Page"
        >
          <ChevronsLeft className="w-4 h-4" />
          First
        </button>

        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-3 py-1 bg-gray-700 rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Prev
        </button>

        {isEditingPage ? (
          <form onSubmit={handlePageInputSubmit}>
            <input
              type="number"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => setIsEditingPage(false)}
              autoFocus
              className="w-16 text-center bg-gray-800 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </form>
        ) : (
          <span
            className="cursor-pointer hover:text-white"
            onClick={() => setIsEditingPage(true)}
          >
            Page {currentPage} of {totalPages}
          </span>
        )}

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-3 py-1 bg-gray-700 rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>

        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="px-3 py-1 bg-gray-700 rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          title="Last Page"
        >
          Last
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-grow" />

      {/* Total items display */}
      <div className="text-sm">
        {totalItems} items
      </div>
        </>
      )}
    </div>
  );
};

export default Pagination;