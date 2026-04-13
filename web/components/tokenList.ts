// 共享常量：支持的链 + 各链常用代币

export const SUPPORTED_CHAINS = [
  { id: 1,     name: 'Ethereum',  nativeSymbol: 'ETH' },
  { id: 42161, name: 'Arbitrum',  nativeSymbol: 'ETH' },
  { id: 10,    name: 'Optimism',  nativeSymbol: 'ETH' },
  { id: 8453,  name: 'Base',      nativeSymbol: 'ETH' },
  { id: 137,   name: 'Polygon',   nativeSymbol: 'MATIC' },
  { id: 56,    name: 'BSC',       nativeSymbol: 'BNB' },
  { id: 43114, name: 'Avalanche', nativeSymbol: 'AVAX' },
]

export const COMMON_TOKENS: Record<number, { symbol: string; address: string; decimals: number }[]> = {
  1: [
    { symbol: 'ETH',  address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'DAI',  address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
    { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  ],
  42161: [
    { symbol: 'ETH',  address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    { symbol: 'DAI',  address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
    { symbol: 'WBTC', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8 },
  ],
  10: [
    { symbol: 'ETH',  address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    { symbol: 'DAI',  address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
  ],
  8453: [
    { symbol: 'ETH',  address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'DAI',  address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    { symbol: 'USDS', address: '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc', decimals: 18 },
  ],
  137: [
    { symbol: 'MATIC', address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    { symbol: 'USDC',  address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    { symbol: 'USDT',  address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'DAI',   address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
  ],
  56: [
    { symbol: 'BNB',  address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  ],
  43114: [
    { symbol: 'AVAX', address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
    { symbol: 'USDT', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
  ],
}
