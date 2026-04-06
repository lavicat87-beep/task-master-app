import os
from flask import Flask, render_template, url_for, request, redirect
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from datetime import datetime

# 1. Modern SQLAlchemy 2.0 Setup
class Base(DeclarativeBase):
    pass

app = Flask(__name__)

# 2. THE PATH FIX: This forces the database into the correct folder on Render
basedir = os.path.abspath(os.path.dirname(__file__))
db_path = os.path.join(basedir, 'tasks.db')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + db_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app, model_class=Base)

# 3. THE "FORCE" COMMAND: This runs every time Render starts the app
with app.app_context():
    # This creates the table if it doesn't exist
    db.create_all()
    print(f"✅ Database tables verified/created at: {db_path}")

class Todo(db.Model):
    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(nullable=False)
    date_created: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    def __repr__(self):
        return f'<Task {self.id}>'

@app.route('/', methods=['POST', 'GET'])
def index():
    if request.method == 'POST':
        task_content = request.form['content']
        new_task = Todo(content=task_content)
        try:
            db.session.add(new_task)
            db.session.commit()
            return redirect('/')
        except:
            return 'There was a problem adding your task'
    else:
        # If the table exists, this will now work perfectly
        tasks = Todo.query.order_by(Todo.date_created).all()
        return render_template('index.html', tasks=tasks)

@app.route('/delete/<int:id>')
def delete(id):
    task_to_delete = Todo.query.get_or_404(id)
    try:
        db.session.delete(task_to_delete)
        db.session.commit()
        return redirect('/')
    except:
        return 'There was a problem deleting that task'

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
