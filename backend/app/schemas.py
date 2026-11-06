from datetime import date

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class AccountRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    id: int
    email: EmailStr


class ForecastRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    route: str = Field(min_length=3, max_length=24)
    date: date
    price: float = Field(ge=0, allow_inf_nan=False)
