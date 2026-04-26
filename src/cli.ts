#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { MergeConfig } from './types';
import { merge } from './merger';

const program = new Command();

program
  .name('jsonconv')
  .description('JSON关联合并工具 - 支持自定义字段匹配和转换')
  .version('1.0.0');

program
  .command('merge')
  .description('根据配置文件合并两个JSON数组')
  .requiredOption('-c, --config <path>', '配置文件路径')
  .option('-o, --output <path>', '输出文件路径（覆盖配置文件中的设置）')
  .option('--pretty', '格式化输出JSON', false)
  .action((options) => {
    try {
      const configPath = path.resolve(options.config);
      if (!fs.existsSync(configPath)) {
        console.error(`配置文件不存在: ${configPath}`);
        process.exit(1);
      }

      const configRaw = fs.readFileSync(configPath, 'utf-8');
      const config: MergeConfig = JSON.parse(configRaw);

      const leftPath = path.resolve(path.dirname(configPath), config.leftFile);
      const rightPath = path.resolve(path.dirname(configPath), config.rightFile);

      if (!fs.existsSync(leftPath)) {
        console.error(`左侧JSON文件不存在: ${leftPath}`);
        process.exit(1);
      }
      if (!fs.existsSync(rightPath)) {
        console.error(`右侧JSON文件不存在: ${rightPath}`);
        process.exit(1);
      }

      const leftData = JSON.parse(fs.readFileSync(leftPath, 'utf-8'));
      const rightData = JSON.parse(fs.readFileSync(rightPath, 'utf-8'));

      if (!Array.isArray(leftData)) {
        console.error('左侧JSON数据不是数组');
        process.exit(1);
      }
      if (!Array.isArray(rightData)) {
        console.error('右侧JSON数据不是数组');
        process.exit(1);
      }

      const result = merge(leftData, rightData, config);

      const outputPath = options.output
        ? path.resolve(options.output)
        : path.resolve(path.dirname(configPath), config.outputFile);

      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const jsonOutput = options.pretty
        ? JSON.stringify(result.data, null, 2)
        : JSON.stringify(result.data);

      fs.writeFileSync(outputPath, jsonOutput, 'utf-8');

      console.log('合并完成!');
      console.log(`  左侧记录数: ${result.stats.leftTotal}`);
      console.log(`  右侧记录数: ${result.stats.rightTotal}`);
      console.log(`  匹配记录数: ${result.stats.matched}`);
      console.log(`  左侧未匹配: ${result.stats.unmatchedLeft}`);
      console.log(`  右侧未匹配: ${result.stats.unmatchedRight}`);
      console.log(`  输出记录数: ${result.stats.outputTotal}`);
      console.log(`  输出文件: ${outputPath}`);
    } catch (err) {
      console.error('合并失败:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('init')
  .description('生成示例配置文件')
  .option('-o, --output <path>', '输出路径', 'merge-config.json')
  .action((options) => {
    const exampleConfig: MergeConfig = {
      leftFile: 'left.json',
      rightFile: 'right.json',
      outputFile: 'output.json',
      fieldMappings: [
        {
          leftField: 'id',
          rightField: 'userId',
        },
        {
          leftField: 'code',
          rightField: 'productCode',
          leftTransform: {
            type: 'prefix',
            args: { value: 'SKU-' },
          },
        },
      ],
      mergeMode: 'left',
      leftAlias: 'left',
      rightAlias: 'right',
      conflictStrategy: 'prefix',
      unmatchedLeft: 'include',
      unmatchedRight: 'exclude',
    };

    const outputPath = path.resolve(options.output);
    fs.writeFileSync(outputPath, JSON.stringify(exampleConfig, null, 2), 'utf-8');
    console.log(`示例配置文件已生成: ${outputPath}`);
  });

program.parse();
