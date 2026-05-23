export const successResponse = (data?: unknown, message = "Success") => {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
};

export const errorResponse = (
  message = "Something went wrong",
  statusCode = 400,
  details?: unknown,
) => {
  return {
    success: false,
    message,
    statusCode,
    details,
    timestamp: new Date().toISOString(),
  };
};
