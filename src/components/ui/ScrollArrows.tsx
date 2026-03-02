import { useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

export function ScrollArrows() {
  const [showUp, setShowUp] = useState(false);
  const [showDown, setShowDown] = useState(false);

  const update = useCallback(() => {
    const scrollTop = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    setShowUp(scrollTop > 50);
    setShowDown(scrollTop + clientHeight < scrollHeight - 50);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  const scroll = (dir: "up" | "down") =>
    window.scrollBy({ top: dir === "up" ? -300 : 300, behavior: "smooth" });

  const btn =
    "flex items-center justify-center w-8 h-8 rounded-md border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary transition-colors shadow-md";

  return (
    <div className="fixed bottom-4 right-1 z-50 flex flex-col gap-1">
      {showUp && (
        <button className={btn} onClick={() => scroll("up")} aria-label="Scroll up">
          <ChevronUp size={18} />
        </button>
      )}
      {showDown && (
        <button className={btn} onClick={() => scroll("down")} aria-label="Scroll down">
          <ChevronDown size={18} />
        </button>
      )}
    </div>
  );
}
