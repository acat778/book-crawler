import mysql from 'mysql2/promise';
import config from '../config.js';

/** @type {mysql.Pool} */
let pool = null;

/**
 * 获取 MySQL 连接池
 */
export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      charset: config.mysql.charset,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      // 将 BIGINT 转换为 Number（Snowflake ID 约 16-17 位，在 Number 安全范围内）
      supportBigNumbers: true,
      bigNumberStrings: false,
    });
  }
  return pool;
}

/**
 * 生成 Snowflake 风格唯一 ID（基于时间戳）
 * 返回一个 16-17 位的数字，兼容 MySQL BIGINT
 */
export function generateId() {
  // 使用微秒级时间戳 + 随机数，保证唯一性
  return Math.floor(Date.now() * 1000 + Math.random() * 1000);
}

/**
 * 执行查询并返回全部结果
 */
export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/**
 * 执行查询并返回第一条结果
 */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 执行 INSERT 并返回自增 ID 或影响行数
 */
export async function insert(sql, params = []) {
  const [result] = await getPool().execute(sql, params);
  return result;
}

/**
 * 执行 UPDATE / DELETE
 */
export async function execute(sql, params = []) {
  const [result] = await getPool().execute(sql, params);
  return result;
}

/**
 * 测试数据库连接
 */
export async function testConnection() {
  const conn = await getPool().getConnection();
  await conn.ping();
  conn.release();
  return true;
}
