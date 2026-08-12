function toPositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getPagination(query = {}, options = {}) {
  const defaultLimit = toPositiveInt(options.defaultLimit, 20);
  const maxLimit = toPositiveInt(options.maxLimit, 100);
  const page = Math.max(toPositiveInt(query.page, 1), 1);
  const limit = Math.min(Math.max(toPositiveInt(query.limit, defaultLimit), 1), maxLimit);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function getCursorPagination(query = {}, options = {}) {
  const defaultLimit = toPositiveInt(options.defaultLimit, 30);
  const maxLimit = toPositiveInt(options.maxLimit, 100);
  const limit = Math.min(Math.max(toPositiveInt(query.limit, defaultLimit), 1), maxLimit);
  const before = query.before || query.beforeCreatedAt || query.cursor || null;
  return { limit, before };
}

function buildPaginatedResponse({ rows = [], count = 0, page = 1, limit = 20 }) {
  const total = Number(count || 0);
  return {
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1
    }
  };
}

function buildCursorResponse({ rows = [], limit = 30, cursorField = 'createdAt', cursorPosition = 'last' }) {
  const cursorRow = rows.length ? (cursorPosition === 'first' ? rows[0] : rows[rows.length - 1]) : null;
  const value = cursorRow && (cursorRow[cursorField] || (typeof cursorRow.get === 'function' ? cursorRow.get(cursorField) : null));
  return {
    data: rows,
    pagination: {
      limit,
      nextCursor: value || null,
      hasMore: rows.length >= limit
    }
  };
}

module.exports = {
  getPagination,
  getCursorPagination,
  buildPaginatedResponse,
  buildCursorResponse,
  makePageResponse: buildPaginatedResponse
};
