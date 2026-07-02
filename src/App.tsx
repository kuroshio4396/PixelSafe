import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Eraser, Pen, Trash2, Image as ImageIcon, Undo2, ZoomIn, ZoomOut, Droplets, Grid } from 'lucide-react';

type ToolMode = 'brush' | 'eraser';
type BlurType = 'gaussian' | 'mosaic';

export default function App() {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [blurIntensity, setBlurIntensity] = useState(15);
  const [blurType, setBlurType] = useState<BlurType>('gaussian');
  const [mode, setMode] = useState<ToolMode>('brush');
  const [isDrawing, setIsDrawing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const [cursorPos, setCursorPos] = useState<{x: number, y: number} | null>(null);
  const [baseScale, setBaseScale] = useState(1);

  // Canvas Refs
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const maskHistory = useRef<ImageData[]>([]);

  // Initialize hidden canvases when an image is loaded
  const initCanvases = (img: HTMLImageElement) => {
    const width = img.width;
    const height = img.height;

    // Set display canvas size (internal resolution)
    if (displayCanvasRef.current) {
      displayCanvasRef.current.width = width;
      displayCanvasRef.current.height = height;
    }

    // Create or resize hidden canvases
    const createOrResize = (ref: React.MutableRefObject<HTMLCanvasElement | null>) => {
      if (!ref.current) {
        ref.current = document.createElement('canvas');
      }
      ref.current.width = width;
      ref.current.height = height;
      return ref.current;
    };

    const origCanvas = createOrResize(origCanvasRef);
    const blurCanvas = createOrResize(blurCanvasRef);
    createOrResize(maskCanvasRef);
    createOrResize(tempCanvasRef);

    // Draw original image
    const origCtx = origCanvas.getContext('2d');
    if (origCtx) {
      origCtx.clearRect(0, 0, width, height);
      origCtx.drawImage(img, 0, 0);
    }

    // Initial blur generation
    updateBlurCanvas(width, height);
    setImageLoaded(true);
    maskHistory.current = [];
    setCanUndo(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Render the final composite to the display canvas
  const renderCanvas = useCallback(() => {
    if (
      !displayCanvasRef.current ||
      !origCanvasRef.current ||
      !blurCanvasRef.current ||
      !maskCanvasRef.current ||
      !tempCanvasRef.current
    ) return;

    const displayCtx = displayCanvasRef.current.getContext('2d');
    const tempCtx = tempCanvasRef.current.getContext('2d');
    if (!displayCtx || !tempCtx) return;

    const width = displayCanvasRef.current.width;
    const height = displayCanvasRef.current.height;

    // 1. Draw original to display (background)
    displayCtx.clearRect(0, 0, width, height);
    displayCtx.drawImage(origCanvasRef.current, 0, 0);

    // 2. Prepare temp canvas with masked blur
    tempCtx.clearRect(0, 0, width, height);
    tempCtx.drawImage(blurCanvasRef.current, 0, 0);

    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.drawImage(maskCanvasRef.current, 0, 0);
    tempCtx.globalCompositeOperation = 'source-over'; // reset

    // 3. Draw the masked blur over display
    displayCtx.drawImage(tempCanvasRef.current, 0, 0);
  }, []);

  // Update the hidden blurred canvas when intensity changes
  const updateBlurCanvas = useCallback((w?: number, h?: number) => {
    if (!origCanvasRef.current || !blurCanvasRef.current) return;
    const blurCtx = blurCanvasRef.current.getContext('2d');
    if (!blurCtx) return;

    const width = w || blurCanvasRef.current.width;
    const height = h || blurCanvasRef.current.height;

    blurCtx.clearRect(0, 0, width, height);

    if (blurType === 'gaussian') {
      blurCtx.filter = `blur(${blurIntensity}px)`;
      blurCtx.drawImage(origCanvasRef.current, 0, 0);
      blurCtx.filter = 'none';
    } else if (blurType === 'mosaic') {
      const blockSize = Math.max(2, blurIntensity);
      const sw = Math.ceil(width / blockSize);
      const sh = Math.ceil(height / blockSize);
      
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = sw;
      tempCanvas.height = sh;
      const tCtx = tempCanvas.getContext('2d');
      if (tCtx) {
        tCtx.drawImage(origCanvasRef.current, 0, 0, sw, sh);
        blurCtx.imageSmoothingEnabled = false;
        blurCtx.drawImage(tempCanvas, 0, 0, width, height);
        blurCtx.imageSmoothingEnabled = true;
      }
    }

    renderCanvas();
  }, [blurIntensity, blurType, renderCanvas]);

  // Effect to re-blur when intensity slider changes (after image is loaded)
  useEffect(() => {
    if (imageLoaded) {
      updateBlurCanvas();
    }
  }, [blurIntensity, blurType, imageLoaded, updateBlurCanvas]);

  const saveHistoryState = () => {
    if (!maskCanvasRef.current) return;
    const maskCtx = maskCanvasRef.current.getContext('2d');
    if (!maskCtx) return;
    
    const width = maskCanvasRef.current.width;
    const height = maskCanvasRef.current.height;
    const imgData = maskCtx.getImageData(0, 0, width, height);
    
    maskHistory.current.push(imgData);
    if (maskHistory.current.length > 20) {
      maskHistory.current.shift();
    }
    setCanUndo(true);
  };

  const handleUndo = useCallback(() => {
    if (maskHistory.current.length === 0 || !maskCanvasRef.current) return;
    
    const maskCtx = maskCanvasRef.current.getContext('2d');
    if (!maskCtx) return;

    const lastState = maskHistory.current.pop();
    if (lastState) {
      maskCtx.putImageData(lastState, 0, 0);
      setCanUndo(maskHistory.current.length > 0);
      renderCanvas();
    }
  }, [renderCanvas]);

  useEffect(() => {
    if (!displayCanvasRef.current || !imageLoaded) return;
    
    const canvas = displayCanvasRef.current;
    setBaseScale(canvas.clientWidth / canvas.width);

    const observer = new ResizeObserver(() => {
      setBaseScale(canvas.clientWidth / canvas.width);
    });
    
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [imageLoaded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if (e.code === 'Space') {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setIsSpaceDown(true);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleUndo]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelEvent = (e: WheelEvent) => {
      if (!imageLoaded) return;
      e.preventDefault();
      
      setZoom(prevZoom => {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(Math.max(0.1, prevZoom * delta), 10);
        if (newZoom === prevZoom) return prevZoom;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const deltaX = mouseX - centerX;
        const deltaY = mouseY - centerY;

        setPan(prevPan => {
          const imageX = (deltaX - prevPan.x) / prevZoom;
          const imageY = (deltaY - prevPan.y) / prevZoom;

          return {
            x: deltaX - imageX * newZoom,
            y: deltaY - imageY * newZoom
          };
        });

        return newZoom;
      });
    };

    container.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => container.removeEventListener('wheel', handleWheelEvent);
  }, [imageLoaded]);

  const handleZoomChange = (multiplier: number) => {
    setZoom(prev => Math.min(Math.max(0.1, prev * multiplier), 10));
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        initCanvases(img);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    // Reset input
    e.target.value = '';
  };

  const getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!imageLoaded) return;
    
    if (isSpaceDown || e.button === 1 || e.button === 2) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (e.target === displayCanvasRef.current) {
      if (!maskCanvasRef.current) return;
      
      saveHistoryState();
      setIsDrawing(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      
      const coords = getCanvasCoords(e.clientX, e.clientY);
      lastPos.current = coords;
      drawPath(coords.x, coords.y, coords.x, coords.y);
      renderCanvas();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y
      });
      setCursorPos(null);
      return;
    }

    const isMouseOrPen = e.pointerType === 'mouse' || e.pointerType === 'pen';

    if (isDrawing && maskCanvasRef.current) {
      const coords = getCanvasCoords(e.clientX, e.clientY);
      drawPath(lastPos.current.x, lastPos.current.y, coords.x, coords.y);
      lastPos.current = coords;
      renderCanvas();
      if (isMouseOrPen) {
        setCursorPos({ x: e.clientX, y: e.clientY });
      }
      return;
    }

    if (e.target === displayCanvasRef.current && !isSpaceDown && isMouseOrPen) {
      setCursorPos({ x: e.clientX, y: e.clientY });
    } else {
      setCursorPos(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    setIsDrawing(false);
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') {
      setCursorPos(null);
    }
  };

  const handlePointerLeave = () => {
    if (!isDrawing) {
      setCursorPos(null);
    }
  };

  const drawPath = (startX: number, startY: number, endX: number, endY: number) => {
    const maskCtx = maskCanvasRef.current?.getContext('2d');
    if (!maskCtx) return;

    maskCtx.globalCompositeOperation = mode === 'eraser' ? 'destination-out' : 'source-over';
    maskCtx.lineWidth = brushSize;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';

    // We use a solid black color for the mask. Opacity/color doesn't matter for destination-in later,
    // only the alpha channel matters.
    maskCtx.strokeStyle = 'rgba(0,0,0,1)';
    maskCtx.fillStyle = 'rgba(0,0,0,1)';

    maskCtx.beginPath();
    maskCtx.moveTo(startX, startY);
    maskCtx.lineTo(endX, endY);
    maskCtx.stroke();
  };

  const handleClearMask = () => {
    if (!maskCanvasRef.current || !displayCanvasRef.current) return;
    saveHistoryState();
    const maskCtx = maskCanvasRef.current.getContext('2d');
    if (maskCtx) {
      maskCtx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      renderCanvas();
    }
  };

  const handleExport = () => {
    if (!displayCanvasRef.current) return;
    
    displayCanvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pixel-safe-image.png';
      a.click();
      
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 100);
    }, 'image/png');
  };

  const visualBrushSize = brushSize * baseScale * zoom;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
            <ImageIcon className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800 tracking-tight">图片打码工具</h1>
        </div>
        
        {imageLoaded && (
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors text-sm shadow-sm"
          >
            <Download className="w-4 h-4" />
            导出图片
          </button>
        )}
      </header>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Toolbar (Sidebar) */}
        <aside className="w-72 border-r border-slate-200 bg-white p-6 flex flex-col gap-8 shrink-0 overflow-y-auto shadow-sm z-10">
          {/* Upload Section */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">图片文件</h2>
            <label className="flex items-center justify-center gap-2 px-4 py-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer transition-colors group shadow-sm">
              <Upload className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" />
              <span className="font-medium text-slate-700 text-sm">上传新图片</span>
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleImageUpload} 
                className="hidden" 
              />
            </label>
          </div>

          {/* Tools Section */}
          <div className={`flex flex-col gap-8 transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            
            <div className="flex flex-col gap-4">
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">工具模式</h2>
              <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/60">
                <button
                  onClick={() => setMode('brush')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    mode === 'brush' ? 'bg-white text-blue-600 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <Pen className="w-4 h-4" />
                  画笔
                </button>
                <button
                  onClick={() => setMode('eraser')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    mode === 'eraser' ? 'bg-white text-blue-600 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <Eraser className="w-4 h-4" />
                  橡皮擦
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">笔触大小</h2>
                <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">{brushSize}px</span>
              </div>
              <input
                type="range"
                min="5"
                max="150"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            <div className="flex flex-col gap-4">
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">打码类型</h2>
              <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/60">
                <button
                  onClick={() => setBlurType('gaussian')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors ${
                    blurType === 'gaussian' ? 'bg-white text-blue-600 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <Droplets className="w-4 h-4" />
                  高斯模糊
                </button>
                <button
                  onClick={() => setBlurType('mosaic')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors ${
                    blurType === 'mosaic' ? 'bg-white text-blue-600 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <Grid className="w-4 h-4" />
                  马赛克
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">模糊/马赛克程度</h2>
                <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">{blurIntensity}px</span>
              </div>
              <input
                type="range"
                min="2"
                max="50"
                value={blurIntensity}
                onChange={(e) => setBlurIntensity(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">缩放比例</h2>
                <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                  {Math.round(zoom * 100)}%
                </span>
              </div>
              <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/60">
                <button
                  onClick={() => handleZoomChange(1/1.2)}
                  className="flex-1 flex items-center justify-center py-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 transition-colors"
                  title="缩小"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setZoom(1); setPan({x: 0, y: 0}); }}
                  className="flex-1 flex items-center justify-center py-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 transition-colors text-xs font-medium"
                  title="重置 1:1"
                >
                  1:1
                </button>
                <button
                  onClick={() => handleZoomChange(1.2)}
                  className="flex-1 flex items-center justify-center py-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 transition-colors"
                  title="放大"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-col gap-3">
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors text-sm border ${
                  canUndo ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-sm' : 'bg-slate-50 text-slate-400 border-transparent cursor-not-allowed'
                }`}
              >
                <Undo2 className="w-4 h-4" />
                撤销 (Ctrl+Z)
              </button>
              <button
                onClick={handleClearMask}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium transition-colors text-sm border border-red-100"
              >
                <Trash2 className="w-4 h-4" />
                清除所有打码
              </button>
            </div>

          </div>
        </aside>

        {/* Canvas Area */}
        <main 
          ref={containerRef}
          className="flex-1 bg-slate-100 overflow-hidden relative select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onContextMenu={handleContextMenu}
          style={{
            cursor: isPanning ? 'grabbing' : isSpaceDown ? 'grab' : 'default'
          }}
        >
          {cursorPos && !isSpaceDown && !isPanning && imageLoaded && (
            <div
              className="fixed pointer-events-none z-50 rounded-full"
              style={{
                left: cursorPos.x,
                top: cursorPos.y,
                width: Math.max(visualBrushSize, 2),
                height: Math.max(visualBrushSize, 2),
                transform: 'translate(-50%, -50%)',
                border: '1.5px solid white',
                mixBlendMode: 'difference',
              }}
            />
          )}

          {!imageLoaded ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center max-w-md mx-auto text-center pointer-events-none">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-200">
                <ImageIcon className="w-10 h-10 text-slate-400" />
              </div>
              <h3 className="text-xl font-medium text-slate-700 mb-2">暂无图片</h3>
              <p className="text-slate-500 mb-8">请从左侧面板上传一张图片，即可开始使用打码工具。</p>
              <label className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors font-medium shadow-sm pointer-events-auto">
                <Upload className="w-5 h-5" />
                <span>选择图片</span>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleImageUpload} 
                  className="hidden" 
                />
              </label>
            </div>
          ) : (
            <div 
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div 
                className="relative shadow-md rounded-md overflow-hidden bg-white border border-slate-200 pointer-events-auto"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                }}
              >
                {/* Checkboard background for transparent images */}
                <div className="absolute inset-0 z-0 pointer-events-none" style={{
                  backgroundImage: 'repeating-linear-gradient(45deg, #e2e8f0 25%, transparent 25%, transparent 75%, #e2e8f0 75%, #e2e8f0), repeating-linear-gradient(45deg, #e2e8f0 25%, #f8fafc 25%, #f8fafc 75%, #e2e8f0 75%, #e2e8f0)',
                  backgroundPosition: '0 0, 10px 10px',
                  backgroundSize: '20px 20px'
                }}></div>
                
                <canvas
                  ref={displayCanvasRef}
                  className="relative z-10 touch-none block"
                  style={{
                    maxWidth: '85vw',
                    maxHeight: 'calc(100vh - 8rem)',
                    cursor: (isSpaceDown || isPanning) ? 'inherit' : 'none',
                  }}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
