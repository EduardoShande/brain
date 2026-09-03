"""Public questions and answers between students.

Every endpoint here is deliberately public-read and authenticated-write.
There is no endpoint that lets one student send another student anything
privately, and that omission is the feature.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.safety import check_text
from app.db.session import get_db
from app.models.community import Answer, Question, Report
from app.models.user import User
from app.schemas.community import (
    AnswerCreate,
    AnswerRead,
    QuestionCreate,
    QuestionDetail,
    QuestionRead,
    ReportCreate,
)

router = APIRouter(prefix="/community", tags=["community"])

# A post every 30 seconds is plenty for a person and useless for a spammer.
POST_COOLDOWN = timedelta(seconds=30)
# Hide anything three different people have flagged, until a human looks.
AUTO_HIDE_AT = 3


def _display_name(user: User) -> str:
    """First name only. Never the email, which is how you leak contact details."""
    if user.full_name and user.full_name.strip():
        return user.full_name.strip().split(" ")[0][:40]
    return f"Student {user.id}"


def _guard_text(*parts: str) -> None:
    for part in parts:
        reason = check_text(part)
        if reason:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=reason)


def _guard_rate(db: Session, user: User, model) -> None:
    since = datetime.now(timezone.utc) - POST_COOLDOWN
    recent = db.scalar(
        select(func.count())
        .select_from(model)
        .where(model.author_id == user.id, model.created_at >= since)
    )
    if recent:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Give it half a minute between posts.",
        )


def _q_read(q: Question, names: dict[int, str], me: int, counts: dict[int, int],
            solved: set[int]) -> dict:
    return {
        "id": q.id,
        "author_name": names.get(q.author_id, "Student"),
        "is_mine": q.author_id == me,
        "course": q.course,
        "title": q.title,
        "body": q.body,
        "answer_count": counts.get(q.id, 0),
        "solved": q.id in solved,
        "created_at": q.created_at,
    }


@router.get("/questions", response_model=list[QuestionRead])
def list_questions(
    course: str | None = Query(default=None, max_length=40),
    unanswered: bool = Query(default=False),
    limit: int = Query(default=50, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    stmt = select(Question).where(Question.hidden.is_(False))
    if course:
        stmt = stmt.where(Question.course == course)
    rows = list(db.scalars(stmt.order_by(Question.created_at.desc()).limit(limit)))
    if not rows:
        return []

    ids = [q.id for q in rows]
    counts = dict(
        db.execute(
            select(Answer.question_id, func.count())
            .where(Answer.question_id.in_(ids), Answer.hidden.is_(False))
            .group_by(Answer.question_id)
        ).all()
    )
    solved = set(
        db.scalars(
            select(Answer.question_id).where(
                Answer.question_id.in_(ids),
                Answer.accepted.is_(True),
                Answer.hidden.is_(False),
            )
        )
    )
    author_ids = {q.author_id for q in rows}
    names = {
        u.id: _display_name(u)
        for u in db.scalars(select(User).where(User.id.in_(author_ids)))
    }
    out = [_q_read(q, names, current_user.id, counts, solved) for q in rows]
    if unanswered:
        out = [q for q in out if q["answer_count"] == 0]
    return out


@router.post("/questions", response_model=QuestionRead, status_code=status.HTTP_201_CREATED)
def ask_question(
    data: QuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _guard_text(data.title, data.body)
    _guard_rate(db, current_user, Question)
    q = Question(
        author_id=current_user.id,
        course=data.course,
        title=data.title.strip(),
        body=data.body.strip(),
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return _q_read(q, {current_user.id: _display_name(current_user)},
                   current_user.id, {}, set())


@router.get("/questions/{question_id}", response_model=QuestionDetail)
def read_question(
    question_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    q = db.get(Question, question_id)
    if q is None or q.hidden:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such question")
    answers = list(
        db.scalars(
            select(Answer)
            .where(Answer.question_id == q.id, Answer.hidden.is_(False))
            .order_by(Answer.accepted.desc(), Answer.created_at.asc())
        )
    )
    author_ids = {q.author_id} | {a.author_id for a in answers}
    names = {
        u.id: _display_name(u)
        for u in db.scalars(select(User).where(User.id.in_(author_ids)))
    }
    data = _q_read(
        q, names, current_user.id,
        {q.id: len(answers)},
        {q.id} if any(a.accepted for a in answers) else set(),
    )
    data["answers"] = [
        {
            "id": a.id,
            "question_id": a.question_id,
            "author_name": names.get(a.author_id, "Student"),
            "is_mine": a.author_id == current_user.id,
            "accepted": a.accepted,
            "body": a.body,
            "created_at": a.created_at,
        }
        for a in answers
    ]
    return data


@router.post("/questions/{question_id}/answers", response_model=AnswerRead,
             status_code=status.HTTP_201_CREATED)
def answer_question(
    question_id: int,
    data: AnswerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    q = db.get(Question, question_id)
    if q is None or q.hidden:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such question")
    _guard_text(data.body)
    _guard_rate(db, current_user, Answer)
    a = Answer(question_id=q.id, author_id=current_user.id, body=data.body.strip())
    db.add(a)
    db.commit()
    db.refresh(a)
    return {
        "id": a.id,
        "question_id": a.question_id,
        "author_name": _display_name(current_user),
        "is_mine": True,
        "accepted": a.accepted,
        "body": a.body,
        "created_at": a.created_at,
    }


@router.post("/answers/{answer_id}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_answer(
    answer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    a = db.get(Answer, answer_id)
    if a is None or a.hidden:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such answer")
    q = db.get(Question, a.question_id)
    if q is None or q.author_id != current_user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only the person who asked can mark the answer that helped.",
        )
    for other in db.scalars(select(Answer).where(Answer.question_id == q.id)):
        other.accepted = other.id == a.id
    db.commit()


@router.post("/report", status_code=status.HTTP_204_NO_CONTENT)
def report(
    data: ReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Flag a post. Three different reporters hides it until a human decides."""
    model = Question if data.target_kind == "question" else Answer
    target = db.get(model, data.target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such post")

    already = db.scalar(
        select(Report).where(
            Report.reporter_id == current_user.id,
            Report.target_kind == data.target_kind,
            Report.target_id == data.target_id,
        )
    )
    if already:
        return

    db.add(
        Report(
            reporter_id=current_user.id,
            target_kind=data.target_kind,
            target_id=data.target_id,
            reason=data.reason.strip(),
        )
    )
    target.report_count += 1
    if target.report_count >= AUTO_HIDE_AT:
        target.hidden = True
    db.commit()
