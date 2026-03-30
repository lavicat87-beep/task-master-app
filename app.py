from flask import Flask, render_template, url_for, request, redirect
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)

basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'tasks.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# 2. THE TASK MODEL
# Think of this as a single row in an Excel spreadsheet
class Todo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(200), nullable=False)
    date_created = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<Task {self.id}>'

# 3. THE HOME ROUTE (View & Add Tasks)
@app.route('/', methods=['POST', 'GET'])
def index():
    if request.method == 'POST':
        task_content = request.form['content']
        new_task = Todo(content=task_content)

        try:
            db.session.add(new_task)
            db.session.commit() # Saves the task to the database
            return redirect('/')
        except:
            return 'There was an issue adding your task'

    else:
        # This grabs all tasks and sorts them by the date they were created
        tasks = Todo.query.order_by(Todo.date_created).all()
        return render_template('index.html', tasks=tasks)

# 4. THE DELETE ROUTE
@app.route('/delete/<int:id>')
def delete(id):
    task_to_delete = Todo.query.get_or_404(id)

    try:
        db.session.delete(task_to_delete)
        db.session.commit() # Removes the task from the database
        return redirect('/')
    except:
        return 'There was a problem deleting that task'

# 5. RENDER-READY STARTUP
if __name__ == "__main__":
    # This automatically creates the 'tasks.db' file if it doesn't exist
    with app.app_context():
        db.create_all()
    
    # Use the port Render gives us, or 5000 for local testing
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
