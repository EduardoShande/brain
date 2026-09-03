"""Request and response shapes for the community.

Note what is NOT here: no email address is ever returned with a post. Students
see a display name and nothing else, because a community of minors should not
hand out contact details as a side effect of asking a question.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AnswerCreate(BaseModel):
    body: str = Field(min_length=2, max_length=4000)


class AnswerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_id: int
    author_name: str
    is_mine: bool
    accepted: bool
    body: str
    created_at: datetime


class QuestionCreate(BaseModel):
    title: str = Field(min_length=8, max_length=160)
    body: str = Field(min_length=10, max_length=4000)
    course: str | None = Field(default=None, max_length=40)


class QuestionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author_name: str
    is_mine: bool
    course: str | None
    title: str
    body: str
    answer_count: int
    solved: bool
    created_at: datetime


class QuestionDetail(QuestionRead):
    answers: list[AnswerRead] = []


class ReportCreate(BaseModel):
    target_kind: str = Field(pattern="^(question|answer)$")
    target_id: int
    reason: str = Field(min_length=3, max_length=200)
