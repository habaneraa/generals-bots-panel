import { createContext, useContext } from 'react';

// 身份只属于这一棵页面树，不使用可被其他页面或并发请求改变的全局 API 状态。
export const PlayerScope = createContext<string | undefined>(undefined);

export function usePlayerId() {
  return useContext(PlayerScope);
}
