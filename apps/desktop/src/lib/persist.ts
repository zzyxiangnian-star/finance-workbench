import { useEffect, useState } from "react";

/** localStorage 只存界面偏好（宽度、主题、当前用户）。读写失败时退回默认值。 */
export function usePersistent<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem("fw:" + key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("fw:" + key, JSON.stringify(value));
    } catch {
      /* 存不了就算了 */
    }
  }, [key, value]);
  return [value, setValue];
}
