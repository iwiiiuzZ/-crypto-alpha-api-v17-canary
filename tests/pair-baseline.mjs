// Compare earlier implementations under the current instrument contract.
// Pinned historical source files and checksums remain unchanged.
export function pairBaseline(source) {
  return source.replaceAll(/(?<![A-Z])ETH(?!A(?:_|\b))/g, 'ZEC')
    .replaceAll('_ETH', '_ZEC').replaceAll('以太坊','大零币')
     .replaceAll('ZEC_TREND_CONFLICT','ASSET_TREND_CONFLICT')
    .replaceAll('ethConflict','assetConflict').replaceAll('ethLiquidity','zecLiquidity')
    .replaceAll('ethusdt','zecusdt').replaceAll(/\beth\b/g,'zec')
    .replaceAll('PI_ZECUSD','PF_ZECUSD').replaceAll('Math.max(12,price','Math.max(price')
    .replaceAll('minimumFirstTargetMoveUsd:40','minimumFirstTargetMoveUsd:0')
    .replaceAll('BTC is the environment filter','use the dual desk for BTC watches')
     .replaceAll('✅ ZEC（大零币）技术预案已就绪', '✅ ${plan.symbol === "BTCUSDT" ? "BTC（比特币）" : "ZEC（大零币）"}技术预案已就绪')
    .replaceAll('btcRole: "ZEC_ENVIRONMENT_FILTER"','btcRole: "EXECUTABLE_AND_ZEC_ENVIRONMENT_FILTER"')
    .replaceAll('    this.env = env;\n  }','    this.env = env;\n    ctx.blockConcurrencyWhile?.(() => retireEtherMonitoring(ctx.storage));\n  }');
}
