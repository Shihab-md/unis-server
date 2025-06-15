import Course from "../models/Course.js";
import redisClient from "../db/redis.js"

const addCourse = async (req, res) => {
  try {
    const {
      code,
      name,
      type,
      remarks,
      fees,
      subject1,
      subject1MaxMark,
      subject1PassMark,
      subject2,
      subject2MaxMark,
      subject2PassMark,
      subject3,
      subject3MaxMark,
      subject3PassMark,
      subject4,
      subject4MaxMark,
      subject4PassMark,
      subject5,
      subject5MaxMark,
      subject5PassMark,
      subject6,
      subject6MaxMark,
      subject6PassMark,
      subject7,
      subject7MaxMark,
      subject7PassMark,
      subject8,
      subject8MaxMark,
      subject8PassMark,
      subject9,
      subject9MaxMark,
      subject9PassMark,
      subject10,
      subject10MaxMark,
      subject10PassMark,
    } = req.body;

    const courseByCode = await Course.findOne({ code: code });
    if (courseByCode != null) {
      return res
        .status(404)
        .json({ success: false, error: "Course Code already exists" });
    }

    const newCourse = new Course({
      code,
      name,
      type,
      remarks,
      fees,
      subject1,
      subject1MaxMark,
      subject1PassMark,
      subject2,
      subject2MaxMark,
      subject2PassMark,
      subject3,
      subject3MaxMark,
      subject3PassMark,
      subject4,
      subject4MaxMark,
      subject4PassMark,
      subject5,
      subject5MaxMark,
      subject5PassMark,
      subject6,
      subject6MaxMark,
      subject6PassMark,
      subject7,
      subject7MaxMark,
      subject7PassMark,
      subject8,
      subject8MaxMark,
      subject8PassMark,
      subject9,
      subject9MaxMark,
      subject9PassMark,
      subject10,
      subject10MaxMark,
      subject10PassMark,
    });

    await newCourse.save()
    return res.status(200).json({ success: true, message: "Course Created Successfully." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding course" });
  }
};

const getCourses = async (req, res) => {
  try {
    const courses = await Course.find().sort({ code: 1 });
 
    if (courses.length > 0) {
      let subjectsCount = 0;
      for (const course of courses) {
        if (course.subject1) {
          subjectsCount++;
        }
        if (course.subject2) {
          subjectsCount++;
        }
        if (course.subject3) {
          subjectsCount++;
        }
        if (course.subject4) {
          subjectsCount++;
        }
        if (course.subject5) {
          subjectsCount++;
        }
        if (course.subject6) {
          subjectsCount++;
        }
        if (course.subject7) {
          subjectsCount++;
        }
        if (course.subject8) {
          subjectsCount++;
        }
        if (course.subject9) {
          subjectsCount++;
        }
        if (course.subject10) {
          subjectsCount++;
        }

        course._subjectsCount = subjectsCount;
        course.toObject({ virtuals: true });

        subjectsCount = 0;
      }
    }

    return res.status(200).json({ success: true, courses });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get courses server error" });
  }
};

const getCoursesFromCache = async (req, res) => {
  try {
    const courses = JSON.parse(await redisClient.get('courses'));
    return res.status(200).json({ success: true, courses });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get courses server error" });
  }
};

const getCourse = async (req, res) => {
  const { id } = req.params;
  try {
    let course = await Course.findById({ _id: id });
    return res.status(200).json({ success: true, course });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get courses server error" });
  }
};

const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      type,
      remarks,
      fees,
      subject1,
      subject1MaxMark,
      subject1PassMark,
      subject2,
      subject2MaxMark,
      subject2PassMark,
      subject3,
      subject3MaxMark,
      subject3PassMark,
      subject4,
      subject4MaxMark,
      subject4PassMark,
      subject5,
      subject5MaxMark,
      subject5PassMark,
      subject6,
      subject6MaxMark,
      subject6PassMark,
      subject7,
      subject7MaxMark,
      subject7PassMark,
      subject8,
      subject8MaxMark,
      subject8PassMark,
      subject9,
      subject9MaxMark,
      subject9PassMark,
      subject10,
      subject10MaxMark,
      subject10PassMark, } = req.body;

    const course = await Course.findById({ _id: id });
    if (!course) {
      return res
        .status(404)
        .json({ success: false, error: "Course not found." });
    }

    const updateCourse = await Course.findByIdAndUpdate({ _id: id }, {
      name,
      type,
      remarks,
      fees,
      subject1,
      subject1MaxMark,
      subject1PassMark,
      subject2,
      subject2MaxMark,
      subject2PassMark,
      subject3,
      subject3MaxMark,
      subject3PassMark,
      subject4,
      subject4MaxMark,
      subject4PassMark,
      subject5,
      subject5MaxMark,
      subject5PassMark,
      subject6,
      subject6MaxMark,
      subject6PassMark,
      subject7,
      subject7MaxMark,
      subject7PassMark,
      subject8,
      subject8MaxMark,
      subject8PassMark,
      subject9,
      subject9MaxMark,
      subject9PassMark,
      subject10,
      subject10MaxMark,
      subject10PassMark,
    })

    if (!updateCourse) {
      return res
        .status(404)
        .json({ success: false, error: "Course update failed." });
    }

    return res.status(200).json({ success: true, message: "Course details updated Successfully." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "Update courses server error" });
  }
};

const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteCourse = await Course.findById({ _id: id })
    await deleteCourse.deleteOne()
    return res.status(200).json({ success: true, deleteCourse })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete Course server error" })
  }
}

export { addCourse, getCourses, getCourse, updateCourse, deleteCourse, getCoursesFromCache };
