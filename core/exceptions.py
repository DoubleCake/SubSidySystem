"""
全局异常定义
所有业务异常继承自 AppException，由全局异常处理器统一捕获并返回标准响应。
"""


class AppException(Exception):
    """业务异常基类"""

    def __init__(self, message: str = "业务错误", code: int = 400, detail: object = None):
        self.message = message
        self.code = code
        self.detail = detail
        super().__init__(self.message)


class NotFound(AppException):
    """资源不存在"""

    def __init__(self, message: str = "资源不存在", detail: object = None):
        super().__init__(message, code=404, detail=detail)


class BadRequest(AppException):
    """请求参数错误"""

    def __init__(self, message: str = "请求参数错误", detail: object = None):
        super().__init__(message, code=400, detail=detail)


class Conflict(AppException):
    """资源冲突（重复创建等）"""

    def __init__(self, message: str = "资源冲突", detail: object = None):
        super().__init__(message, code=409, detail=detail)


class Forbidden(AppException):
    """无权限"""

    def __init__(self, message: str = "无权限", detail: object = None):
        super().__init__(message, code=403, detail=detail)


class ValidationError(AppException):
    """数据验证错误"""

    def __init__(self, message: str = "数据验证失败", errors: list = None):
        super().__init__(message, code=422, detail=errors or [])
