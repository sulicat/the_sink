# The Sink

 - The sink is a simple webapp that exposes simple endpoints.
   - The endpoints injest timestamped and labelled data provided from an external source.
   - the app stores some amount of this data (lets say up to 10 min worth) locally
 - It hosts a website where the user can pick one of a few 3D scenes (defined by a config file).
    - The user can then link various data elements to various things in the 3D scene
    - for example the user can pick "motor_position" to control the rotation of a motor shaft in the 3D scene
  

# For Claude
 - This app needs to be hosted inside a docker container such that it is easy to start and stop
 - the data enpoints can be kept simple, data protocol simple too.
 - The 3D scene needs to be maneuverable similar to blender controls
 - We can keep scene definitions simple to start, a simple json file and only simple objects (spheres/cubes/planes)
 - The gui needs to be easy to understand and the data needs to be easy to categorize.
  