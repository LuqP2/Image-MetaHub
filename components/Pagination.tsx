import React, { useState, useEffect } from 'react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number | 'all';
  onItemsPerPageChange: (items: number | 'all') => void;
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
    onItemsPerPageChange(value === 'all' ? 'all' : parseInt(value, 10));
  };

  const showPageControls = totalPages > 1;

  return (
    <div className="flex justify-between items-center text-sm text-gray-700">
      <div className="text-sm text-gray-600">
        {totalItems} items
      </div>

      <div className="flex items-center gap-2">
        {showPageControls && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="w-16 text-center px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </form>
            ) : (
              <span
                className="cursor-pointer px-2 py-1.5 rounded hover:bg-gray-100"
                onClick={() => setIsEditingPage(true)}
              >
                Page {currentPage} of {totalPages}
              </span>
            )}

            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="items-per-page" className="text-sm">Show:</label>
        <select
          id="items-per-page"
          value={itemsPerPage}
          onChange={handleItemsPerPageChange}
          className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={500}>500</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
  );
};

export default Pagination;