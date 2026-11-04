// Photo — fixed-aspect image with shimmer placeholder, responsive srcset,
// fade-in on load and a graceful fallback. Use for every location image.
import React, { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { sizedImage } from '@/data/destinations';

interface PhotoProps {
  src: string;
  alt: string;
  /** Rendered width in CSS px at the largest breakpoint (used to pick a sensible download size). */
  width?: number;
  /** CSS aspect-ratio, e.g. "4 / 3". Omit when the parent sets the height. */
  ratio?: string;
  caption?: string;
  priority?: boolean;
  className?: string;
  radius?: string;
  children?: React.ReactNode;
}

const isUnsplash = (url: string) => url.includes('images.unsplash.com');

const Photo: React.FC<PhotoProps> = ({
  src, alt, width = 480, ratio, caption, priority = false, className = '', radius, children,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset when the source changes, then pick up images that finished loading (e.g. from cache)
  // before React attached onLoad. One effect so the reset can never run after the check.
  useEffect(() => {
    setFailed(false);
    const img = imgRef.current;
    setLoaded(!!img && img.complete && img.naturalWidth > 0);
  }, [src]);

  const h = ratio ? (() => {
    const [a, b] = ratio.split('/').map(Number);
    return a && b ? Math.round((width * b) / a) : undefined;
  })() : undefined;

  const url1x = isUnsplash(src) ? sizedImage(src, width, h) : src;
  const url2x = isUnsplash(src) ? sizedImage(src, width * 2, h ? h * 2 : undefined) : undefined;

  return (
    <div
      className={`img-frame ${loaded || failed ? 'is-loaded' : ''} ${className}`}
      style={{ aspectRatio: ratio, borderRadius: radius }}
    >
      {failed ? (
        <div className="img-fallback" role="img" aria-label={alt}>
          <ImageOff size={22} strokeWidth={1.5} />
        </div>
      ) : (
        <img
          ref={imgRef}
          src={url1x}
          srcSet={url2x ? `${url1x} 1x, ${url2x} 2x` : undefined}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {caption && !failed && <span className="img-caption">{caption}</span>}
      {children}
    </div>
  );
};

export default Photo;
