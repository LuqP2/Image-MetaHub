import React from 'react';

interface BrandLogoProps {
  variant: 'header' | 'welcome';
}

const BrandLogo: React.FC<BrandLogoProps> = ({ variant }) => {
  const isHeader = variant === 'header';
  const lightSource = 'logo-navy-transparent.png';
  const darkSource = 'logo-white-transparent.png';
  const sizeClassName = isHeader ? 'h-10 w-10' : 'h-64 w-64';
  const alt = isHeader ? '' : 'Image MetaHub';

  return (
    <span className={`block shrink-0 ${sizeClassName}${isHeader ? '' : ' mb-4'}`}>
      <img
        src={`./branding/${lightSource}`}
        alt={alt}
        className={`brand-logo-light object-contain ${sizeClassName}`}
      />
      <img
        src={`./branding/${darkSource}`}
        alt={alt}
        className={`brand-logo-dark object-contain ${sizeClassName}`}
      />
    </span>
  );
};

export default BrandLogo;
