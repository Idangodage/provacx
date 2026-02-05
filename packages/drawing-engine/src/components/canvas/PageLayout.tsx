'use client';

export interface PageLayoutProps {
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  showPage?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  shadow?: string;
}

/**
 * Page layout overlay for the smart drawing canvas.
 * Renders a page boundary to mirror document editor layouts.
 */
export const PageLayout: React.FC<PageLayoutProps> = ({
  pageWidth,
  pageHeight,
  zoom,
  showPage = true,
  backgroundColor = '#fefcf7',
  borderColor = 'rgba(217, 177, 117, 0.9)',
  shadow = '0 20px 45px rgba(15, 23, 42, 0.15)',
}) => {
  if (!showPage || pageWidth <= 0 || pageHeight <= 0) return null;

  // Page is always at origin (0,0) within host container
  // The host container handles positioning, Fabric.js handles zoom/pan
  const pageWidthPx = pageWidth * zoom;
  const pageHeightPx = pageHeight * zoom;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: pageWidthPx,
        height: pageHeightPx,
        backgroundColor,
        border: `1px solid ${borderColor}`,
        boxShadow: shadow,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
};

export default PageLayout;
